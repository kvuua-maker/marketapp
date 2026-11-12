import process from 'node:process';
import { config } from './config.js';
import { createLogger } from './core/logger.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { initImageProxy } from './services/imageProxy.js';
import { seedSuppliers } from './db/seed.js';
import { buildAdapters } from './suppliers/registry.js';
import { DeepSeekClient } from './ai/deepseek.js';
import { AIController } from './ai/controller.js';
import { runAllSyncs } from './jobs/sync.js';
import { startScheduler } from './jobs/scheduler.js';
import { createAppServer } from './api/server.js';
import { deliverOutbox } from './orders/outbox.js';
import { notifySync, sendTelegram, formatPricingSummary, telegramConfigured } from './services/telegram.js';
import { runDynamicPricing } from './jobs/pricing.js';
import { buildDroptPayoutReport, formatPayoutReport } from './payouts/dropt.js';

const logger = createLogger({ app: 'marketapp' });

async function main() {
  const db = openDatabase(config.dbPath);
  migrate(db, logger);
  await initImageProxy(logger);
  const adapters = buildAdapters({ config, logger });

  if (adapters.length === 0) {
    logger.warn('no suppliers enabled — storefront will be empty');
  }

  seedSuppliers(db, adapters);

  // A previous process may have died mid-sync; do not leave a stuck "running" row.
  db.prepare("UPDATE sync_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(
    new Date().toISOString(),
  );

  const client = new DeepSeekClient({
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
    logger: logger.child({ ai: 'deepseek' }),
  });
  const ai = new AIController({ client, config, logger: logger.child({ ai: 'controller' }), db });

  logger.info('AI controller ready', {
    deepseek: ai.enabled,
    marginPercent: config.pricing.marginPercent,
    rounding: config.pricing.rounding,
  });

  const catalogStats = () => {
    try {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS products, COALESCE(SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END), 0) AS inStock FROM products",
        )
        .get();
      return { products: row?.products ?? 0, inStock: row?.inStock ?? 0 };
    } catch {
      return null;
    }
  };

  if (telegramConfigured(config)) {
    logger.info('telegram notifications enabled');
  } else {
    logger.info('telegram notifications disabled (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set)');
  }

  // Two independent schedules:
  //  • the main supplier(s) every SYNC_INTERVAL_MINUTES (90 min by default)
  //  • Dropt (and any other slow feed) daily — DROPT_SYNC_INTERVAL_MINUTES
  // A shared queue guarantees they never write to SQLite at the same time.
  const intervalFor = (adapter) =>
    config.suppliers[adapter.id]?.syncIntervalMinutes ?? config.sync.intervalMinutes;

  const dailyAdapters = adapters.filter((adapter) => intervalFor(adapter) >= 1440);
  const frequentAdapters = adapters.filter((adapter) => intervalFor(adapter) < 1440);

  let syncQueue = Promise.resolve();
  const exclusive = (task) => {
    const next = syncQueue.then(task, task);
    syncQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const makeRunNow = (adapterList, label) =>
    async (reason) =>
      exclusive(async () => {
        try {
          const results = await runAllSyncs({ db, adapters: adapterList, ai, config, logger });
          await deliverOutbox(db, { config, logger });
          await notifySync({ config, logger, reason: `${label}:${reason}`, results, catalog: catalogStats() });
          return results;
        } catch (error) {
          await notifySync({ config, logger, reason: `${label}:${reason}`, error, catalog: catalogStats() });
          throw error;
        }
      });

  const scheduler = startScheduler({
    db,
    intervalMinutes: config.sync.intervalMinutes,
    staleAfterMinutes: config.sync.staleAfterMinutes,
    runNow: makeRunNow(frequentAdapters, 'catalog'),
    logger: logger.child({ job: 'scheduler' }),
  });

  const dailyInterval = dailyAdapters.length
    ? Math.max(...dailyAdapters.map((adapter) => intervalFor(adapter)))
    : 1440;

  const dailyScheduler = dailyAdapters.length
    ? startScheduler({
        db,
        intervalMinutes: dailyInterval,
        staleAfterMinutes: dailyInterval,
        runNow: makeRunNow(dailyAdapters, 'daily'),
        logger: logger.child({ job: 'scheduler-daily' }),
        settingKey: 'last_sync_daily',
      })
    : null;

  if (dailyAdapters.length) {
    logger.info('daily supplier schedule enabled', {
      suppliers: dailyAdapters.map((adapter) => adapter.id),
      intervalMinutes: dailyInterval,
    });
  }

  const pricingOptions = config.pricing.dynamic;
  const pricingScheduler = pricingOptions.enabled
    ? startScheduler({
        db,
        intervalMinutes: pricingOptions.intervalMinutes,
        staleAfterMinutes: pricingOptions.intervalMinutes,
        settingKey: 'last_pricing_run',
        logger: logger.child({ job: 'pricing' }),
        runNow: async (reason) =>
          exclusive(async () => {
            const summary = await runDynamicPricing({
              db,
              config,
              logger: logger.child({ job: 'pricing' }),
              limit: pricingOptions.maxProductsPerRun,
            });
            await sendTelegram({ config, logger, text: formatPricingSummary(summary) });
            logger.info('pricing run finished', { reason, ...summary });
            return summary;
          }),
      })
    : null;

  const payoutScheduler = config.payouts.enabled
    ? startScheduler({
        db,
        intervalMinutes: config.payouts.intervalMinutes,
        staleAfterMinutes: config.payouts.intervalMinutes,
        settingKey: 'last_payout_report',
        logger: logger.child({ job: 'payouts' }),
        runNow: async () => {
          const report = buildDroptPayoutReport(db, { holdDays: config.payouts.holdDays });
          logger.info('dropt payout report', report.totals);
          if (config.notifications.telegram.sync) {
            await sendTelegram({ config, logger, text: formatPayoutReport(report) });
          }
          return report.totals;
        },
      })
    : null;

  if (pricingOptions.enabled) {
    logger.info('dynamic pricing enabled', {
      dryRun: pricingOptions.dryRun,
      floorMargin: pricingOptions.floorMarginPercent,
      undercut: pricingOptions.undercutPercent,
      maxMargin: pricingOptions.maxMarginPercent,
      maxDailyChange: pricingOptions.maxDailyChangePercent,
      sources: pricingOptions.sources,
      maxProducts: pricingOptions.maxProductsPerRun,
    });
  } else {
    logger.info('dynamic pricing disabled (DYNAMIC_PRICING_ENABLED not set)');
  }

  const { server } = createAppServer({
    db,
    adapters,
    ai,
    config,
    logger: logger.child({ api: 'http' }),
    syncTrigger: scheduler.trigger,
  });

  server.listen(config.port, () => {
    logger.info('MarketApp API listening', { port: config.port, env: config.env });
  });

  const shutdown = (signal) => {
    logger.info('shutting down', { signal });
    scheduler.stop();
    dailyScheduler?.stop();
    pricingScheduler?.stop();
    payoutScheduler?.stop();
    server.close(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('unhandled rejection', { error }));
}

main().catch((error) => {
  logger.error('fatal startup error', { error });
  process.exit(1);
});

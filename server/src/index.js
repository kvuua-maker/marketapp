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

  const runNow = async (reason) => {
    const results = await runAllSyncs({ db, adapters, ai, config, logger });
    await deliverOutbox(db, { config, logger });
    return results;
  };

  const scheduler = startScheduler({
    db,
    intervalMinutes: config.sync.intervalMinutes,
    staleAfterMinutes: config.sync.staleAfterMinutes,
    runNow,
    logger: logger.child({ job: 'scheduler' }),
  });

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

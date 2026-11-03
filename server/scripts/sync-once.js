#!/usr/bin/env node
/**
 * One-shot sync for CI, cron systems and debugging.
 * Usage: npm run sync            (all configured suppliers)
 *        npm run sync -- aveopt  (single supplier)
 */
import process from 'node:process';
import { config } from '../src/config.js';
import { createLogger } from '../src/core/logger.js';
import { openDatabase } from '../src/db/database.js';
import { seedSuppliers } from '../src/db/seed.js';
import { buildAdapters } from '../src/suppliers/registry.js';
import { DeepSeekClient } from '../src/ai/deepseek.js';
import { AIController } from '../src/ai/controller.js';
import { runAllSyncs } from '../src/jobs/sync.js';
import { deliverOutbox } from '../src/orders/outbox.js';

const logger = createLogger({ app: 'sync-cli' });
const only = process.argv[2];

const db = openDatabase(config.dbPath);
let adapters = buildAdapters({ config, logger });
if (only) adapters = adapters.filter((adapter) => adapter.id === only);

if (adapters.length === 0) {
  logger.error('no adapters matched', { only });
  process.exit(1);
}

seedSuppliers(db, adapters);

const client = new DeepSeekClient({
  apiKey: config.ai.apiKey,
  baseUrl: config.ai.baseUrl,
  model: config.ai.model,
  timeoutMs: config.ai.timeoutMs,
  maxRetries: config.ai.maxRetries,
  logger,
});
const ai = new AIController({ client, config, logger, db });

const results = await runAllSyncs({ db, adapters, ai, config, logger });
await deliverOutbox(db, { config, logger });

const total = db.prepare('SELECT COUNT(*) AS count FROM products').get();
console.log(JSON.stringify({ results, products: total.count, aiEnabled: ai.enabled }, null, 2));
db.close();
process.exit(results.some((result) => result.status === 'failed') ? 1 : 0);

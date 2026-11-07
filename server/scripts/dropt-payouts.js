#!/usr/bin/env node
/**
 * Dropt payout register (estimate) — run manually or from cron/scheduler.
 *
 *   node scripts/dropt-payouts.js --hold-days=14 --csv
 */
import { writeFileSync } from 'node:fs';
import { openDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { buildDroptPayoutReport, formatPayoutReport } from '../src/payouts/dropt.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const holdDays = Number(args['hold-days'] ?? 14);
const db = openDatabase(config.dbPath);
const report = buildDroptPayoutReport(db, { holdDays });

console.log(formatPayoutReport(report));

if (args.csv) {
  const header = 'order_id,created_at,state,available_at,revenue_uah,cost_uah,margin_uah';
  const lines = report.orders.map((order) =>
    [
      order.id,
      order.createdAt,
      order.state,
      order.availableAt,
      (order.revenueCents / 100).toFixed(2),
      (order.costCents / 100).toFixed(2),
      (order.marginCents / 100).toFixed(2),
    ].join(','),
  );
  const path = 'data/dropt-payouts.csv';
  writeFileSync(path, [header, ...lines].join('\n'), 'utf8');
  console.log(`\nCSV: ${path}`);
}

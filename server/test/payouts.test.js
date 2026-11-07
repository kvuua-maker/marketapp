import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { buildDroptPayoutReport } from '../src/payouts/dropt.js';

function seed() {
  const db = openDatabase(':memory:');
  const now = new Date('2026-11-07T12:00:00Z');
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();

  db.prepare(
    `INSERT INTO products (id, supplier_id, external_id, title, description, image_url,
       cost_cents, price_cents, margin_percent, currency, stock, content_hash, created_at, updated_at)
     VALUES ('dropt_1', 'dropt', '1', 'Товар', 'Опис', 'https://x/1.jpg',
       50000, 62500, 25, 'UAH', 3, 'hash', ?, ?)`,
  ).run(now.toISOString(), now.toISOString());

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, customer_json, total_cents, status, created_at) VALUES (?, '{}', ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, supplier_id, title_snapshot, qty, unit_price_cents,
       supplier_order_status) VALUES (?, 'dropt_1', 'dropt', 'Товар', 1, ?, 'queued')`,
  );

  insertOrder.run('MA-OLD', 62500, 'routed_email', daysAgo(20));
  insertItem.run('MA-OLD', 62500);
  insertOrder.run('MA-NEW', 62500, 'routed_email', daysAgo(2));
  insertItem.run('MA-NEW', 62500);
  insertOrder.run('MA-CANCELLED', 62500, 'cancelled', daysAgo(30));
  insertItem.run('MA-CANCELLED', 62500);

  return { db, now };
}

test('payout register splits available and pending, excludes cancelled', () => {
  const { db, now } = seed();
  const report = buildDroptPayoutReport(db, { holdDays: 14, now });

  assert.equal(report.orders.length, 2, 'cancelled order is excluded');
  assert.equal(report.totals.availableOrders, 1);
  assert.equal(report.totals.pendingOrders, 1);
  assert.equal(report.totals.availableCents, 12_500, '625 − 500 = 125 margin');
  assert.equal(report.totals.pendingCents, 12_500);
  assert.equal(report.totals.revenueCents, 125_000);
  assert.equal(report.totals.costCents, 100_000);
});

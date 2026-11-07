#!/usr/bin/env node
/**
 * Recalculates retail prices for an existing supplier without re-running the
 * AI pipeline: retail = cost × (1 + margin), rounded to x9.
 *
 * Usage:
 *   node scripts/recalc-margin.js --supplier=dropt --margin=25
 *   node scripts/recalc-margin.js --supplier=dropt          # margin from config
 *
 * Safe: only price_cents and margin_percent are touched.
 */
import { openDatabase, transaction } from '../src/db/database.js';
import { retailPrice } from '../src/domain/pricing.js';
import { config } from '../src/config.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const supplierId = args.supplier ?? 'dropt';
const configuredMargin = config.suppliers[supplierId]?.marginPercent;
const marginPercent = args.margin !== undefined ? Number(args.margin) : configuredMargin;

if (!Number.isFinite(marginPercent) || marginPercent <= 0) {
  console.error(`Invalid margin for ${supplierId}: ${marginPercent}`);
  process.exit(2);
}

const db = openDatabase(config.dbPath);
const rows = db
  .prepare('SELECT id, title, cost_cents, price_cents, margin_percent FROM products WHERE supplier_id = ?')
  .all(supplierId);

if (rows.length === 0) {
  console.log(`No products for supplier ${supplierId}`);
  process.exit(0);
}

// The products_au FTS trigger deletes by an UNINDEXED column on every UPDATE,
// which turns a bulk recalculation into O(n²). Drop it, update, rebuild the
// index once, then restore the trigger exactly as defined in schema.sql.
db.exec('DROP TRIGGER IF EXISTS products_au');
const restoreTrigger = () =>
  db.exec(`CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
    DELETE FROM products_fts WHERE id = old.id;
    INSERT INTO products_fts(id, title, description, category, brand)
    VALUES (new.id, new.title, new.description, new.category, new.vendor);
  END;`);

const update = db.prepare('UPDATE products SET price_cents = ?, margin_percent = ? WHERE id = ?');
let changed = 0;
let unchanged = 0;
let skipped = 0;
let sumBefore = 0;
let sumAfter = 0;
const samples = [];

const startedAt = Date.now();
transaction(db, () => {
  for (const row of rows) {
    if (!Number.isFinite(row.cost_cents) || row.cost_cents <= 0) {
      skipped += 1;
      continue;
    }
    const { priceCents } = retailPrice(row.cost_cents, marginPercent, { rounding: config.pricing.rounding });
    sumBefore += row.price_cents;
    sumAfter += priceCents;

    if (priceCents !== row.price_cents || row.margin_percent !== marginPercent) {
      update.run(priceCents, marginPercent, row.id);
      changed += 1;
      const firstAtThisCost = !samples.some((entry) => entry.cost === row.cost_cents);
      if (samples.length < 5 || (row.cost_cents === 26133 && firstAtThisCost)) {
        samples.push({ id: row.id, title: row.title, before: row.price_cents, after: priceCents, cost: row.cost_cents });
      }
    } else {
      unchanged += 1;
    }
  }
});

// Rebuild the search index once (cheaper than 7k individual trigger runs).
db.exec('DELETE FROM products_fts');
db.exec(`INSERT INTO products_fts(id, title, description, category, brand)
         SELECT id, title, description, category, COALESCE(vendor, '') FROM products`);
restoreTrigger();

const pct = (before, after) => (before === 0 ? 0 : ((after - before) / before) * 100).toFixed(1);

console.log(`elapsed: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
console.log(`supplier: ${supplierId}`);
console.log(`margin: ${marginPercent}% (rounding ${config.pricing.rounding})`);
console.log(`products: ${rows.length} | changed: ${changed} | unchanged: ${unchanged} | skipped: ${skipped}`);
console.log(`sum before: ${(sumBefore / 100).toFixed(2)} UAH`);
console.log(`sum after:  ${(sumAfter / 100).toFixed(2)} UAH (${pct(sumBefore, sumAfter)}%)`);
console.log('samples:');
for (const sample of samples) {
  console.log(
    `  ${sample.id} | cost ${(sample.cost / 100).toFixed(2)} | ${(sample.before / 100).toFixed(0)} -> ${(sample.after / 100).toFixed(0)} UAH`,
  );
  if (sample.cost === 26133) {
    console.log(`  ^ ${sample.title.slice(0, 70)}`);
  }
}
db.close();

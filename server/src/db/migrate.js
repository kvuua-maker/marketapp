import { norm, normPhone } from '../domain/normalize.js';
import { guessBrand } from '../domain/brand.js';

/**
 * Idempotent schema migration for already-deployed databases.
 * Adds search/rating/promo/delivery columns and backfills derived values.
 */
export function migrate(db, logger) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);

  const addColumn = (table, name, ddl) => {
    if (!columns(table).includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      return true;
    }
    return false;
  };

  let added = 0;
  if (addColumn('products', 'title_norm', 'TEXT')) added += 1;
  if (addColumn('products', 'description_norm', 'TEXT')) added += 1;
  if (addColumn('products', 'category_norm', 'TEXT')) added += 1;
  if (addColumn('products', 'brand_norm', 'TEXT')) added += 1;
  if (addColumn('products', 'old_price_cents', 'INTEGER')) added += 1;
  if (addColumn('products', 'rating_avg', 'REAL NOT NULL DEFAULT 0')) added += 1;
  if (addColumn('products', 'rating_count', 'INTEGER NOT NULL DEFAULT 0')) added += 1;
  if (addColumn('orders', 'phone_norm', 'TEXT')) added += 1;
  if (addColumn('orders', 'ttn', 'TEXT')) added += 1;
  if (addColumn('orders', 'ttn_status', 'TEXT')) added += 1;

  db.exec('CREATE INDEX IF NOT EXISTS idx_products_title_norm ON products(title_norm)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone_norm)');

  // Backfill normalised search columns for rows inserted before this migration.
  const pending = db.prepare("SELECT COUNT(*) AS c FROM products WHERE title_norm IS NULL").get().c;
  if (pending > 0) {
    const select = db.prepare('SELECT id, title, description, category, category_raw, vendor FROM products WHERE title_norm IS NULL');
    const update = db.prepare(
      `UPDATE products SET title_norm = ?, description_norm = ?, category_norm = ?, brand_norm = ? WHERE id = ?`,
    );
    let done = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of select.all()) {
        update.run(
          norm(row.title),
          norm(row.description),
          norm(row.category),
          norm(row.vendor || row.category_raw || ''),
          row.id,
        );
        done += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    logger?.info('search columns backfilled', { rows: done });
  }

  // The supplier sends no brand; derive one from the title where it is missing.
  const missingBrand = db.prepare("SELECT COUNT(*) AS c FROM products WHERE vendor IS NULL OR vendor = ''").get().c;
  if (missingBrand > 0) {
    const rows = db.prepare("SELECT id, title FROM products WHERE vendor IS NULL OR vendor = ''").all();
    const update = db.prepare('UPDATE products SET vendor = ?, brand_norm = ? WHERE id = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const brand = guessBrand(row.title);
        update.run(brand, norm(brand), row.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    logger?.info('brands derived from titles', { rows: rows.length });
  }

  // Backfill phone_norm for orders created before the column existed.
  const ordersPending = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE phone_norm IS NULL').get().c;
  if (ordersPending > 0) {
    const rows = db.prepare('SELECT id, customer_json FROM orders WHERE phone_norm IS NULL').all();
    const update = db.prepare('UPDATE orders SET phone_norm = ? WHERE id = ?');
    for (const row of rows) {
      let phone = null;
      try {
        phone = normPhone(JSON.parse(row.customer_json)?.phone);
      } catch {
        phone = null;
      }
      update.run(phone, row.id);
    }
  }

  if (added > 0) logger?.info('schema migrated', { columns: added });
}

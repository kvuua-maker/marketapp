import { run } from './database.js';

/** Registers supplier metadata (idempotent). */
export function seedSuppliers(db, adapters) {
  for (const adapter of adapters) {
    run(
      db,
      `INSERT INTO suppliers (id, name, adapter, enabled, config_json)
       VALUES (?, ?, ?, 1, '{}')
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, adapter = excluded.adapter, enabled = 1`,
      { 1: adapter.id, 2: adapter.name, 3: adapter.constructor.name },
    );
  }
}

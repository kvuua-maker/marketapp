-- MarketApp schema. Everything is driven by automation: sync -> AI -> storefront.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS suppliers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  adapter       TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,              -- "<supplierId>:<externalId>"
  supplier_id     TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  image_url       TEXT NOT NULL,
  images_json     TEXT NOT NULL DEFAULT '[]',
  category        TEXT NOT NULL DEFAULT 'Інше',
  category_raw    TEXT,
  cost_cents      INTEGER NOT NULL,              -- wholesale price from supplier
  price_cents     INTEGER NOT NULL,              -- retail price shown to customer
  margin_percent  REAL NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'UAH',
  stock           INTEGER NOT NULL DEFAULT 0,
  product_url     TEXT,
  vendor          TEXT,
  content_hash    TEXT NOT NULL,
  ai_status       TEXT NOT NULL DEFAULT 'published',  -- published | fallback
  ai_meta_json    TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (supplier_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_price    ON products(price_cents);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_updated  ON products(updated_at);

CREATE TABLE IF NOT EXISTS product_rejections (
  supplier_id   TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  reason        TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (supplier_id, external_id)
);

CREATE TABLE IF NOT EXISTS ai_cache (
  content_hash  TEXT PRIMARY KEY,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  client_order_id TEXT UNIQUE,
  customer_json   TEXT NOT NULL,
  total_cents     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'UAH',
  status          TEXT NOT NULL,           -- routed | partially_routed | failed
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            TEXT NOT NULL,
  supplier_id           TEXT NOT NULL,
  title_snapshot        TEXT NOT NULL,
  qty                   INTEGER NOT NULL,
  unit_price_cents      INTEGER NOT NULL,
  supplier_order_status TEXT NOT NULL,     -- queued | sent | failed
  supplier_ref          TEXT,
  error                 TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  channel     TEXT NOT NULL,               -- email | api
  to_addr     TEXT,
  subject     TEXT,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed
  error       TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,             -- running | ok | failed
  fetched       INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 0,
  rejected      INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  message       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

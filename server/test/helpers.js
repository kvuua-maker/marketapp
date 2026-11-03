import { openDatabase, run } from '../src/db/database.js';
import { config } from '../src/config.js';
import { createLogger } from '../src/core/logger.js';

export const logger = createLogger({ test: true, level: 'silent' });

export function makeDb() {
  return openDatabase(':memory:');
}

export function insertProduct(db, overrides = {}) {
  const product = {
    id: 'aveopt:1',
    supplier_id: 'aveopt',
    external_id: '1',
    title: 'Тестовий товар',
    description: 'Опис тестового товару, достатньо довгий для валідації.',
    short_description: 'Короткий опис',
    image_url: 'https://example.com/1.jpg',
    images_json: '["https://example.com/1.jpg"]',
    category: 'Гаджети та аксесуари',
    category_raw: 'Аксесуари',
    cost_cents: 10000,
    price_cents: 12900,
    margin_percent: 15,
    currency: 'UAH',
    stock: 5,
    product_url: 'https://example.com/p/1',
    vendor: 'Test',
    content_hash: 'hash1',
    ai_status: 'published',
    ai_meta_json: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };

  run(
    db,
    `INSERT INTO products (id, supplier_id, external_id, title, description, short_description, image_url,
      images_json, category, category_raw, cost_cents, price_cents, margin_percent, currency, stock,
      product_url, vendor, content_hash, ai_status, ai_meta_json, created_at, updated_at)
     VALUES (:id, :supplier_id, :external_id, :title, :description, :short_description, :image_url,
      :images_json, :category, :category_raw, :cost_cents, :price_cents, :margin_percent, :currency, :stock,
      :product_url, :vendor, :content_hash, :ai_status, :ai_meta_json, :created_at, :updated_at)`,
    Object.fromEntries(Object.entries(product).map(([key, value]) => [`:${key}`, value])),
  );
  return product;
}

export function testConfig(overrides = {}) {
  return {
    ...config,
    pricing: { ...config.pricing, marginPercent: 15, rounding: 'x9', minMarginPercent: 5 },
    orders: {
      ...config.orders,
      emailProvider: 'outbox',
      supplierEmail: { aveopt: 'aveopt@test.local', lugi: 'lugi@test.local' },
    },
    ...overrides,
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, testConfig, logger } from './helpers.js';
import { AIController } from '../src/ai/controller.js';

function makeController(db, { enabled = false } = {}) {
  const client = enabled
    ? {
        enabled: true,
        completeJSON: async ({ user }) => {
          const payload = JSON.parse(user);
          return {
            items: payload.items.map((item) => ({
              index: item.index,
              title_uk: `Українська назва ${item.index}`,
              short_description_uk: 'Короткий український опис товару.',
              category: 'Навушники',
            })),
          };
        },
      }
    : { enabled: false };

  return new AIController({ client, config: testConfig(), logger, db });
}

const rawProduct = {
  supplierId: 'aveopt',
  externalId: '10',
  title: 'Беспроводные наушники Test X1',
  description: 'Отличный звук и автономность до 20 часов. Подходит для спорта и путешествий.',
  imageUrl: 'https://example.com/10.jpg',
  images: ['https://example.com/10.jpg'],
  costCents: 10000,
  currency: 'UAH',
  stock: 5,
  categoryRaw: 'Наушники',
};

test('rejects products without image or with short description', async () => {
  const db = makeDb();
  const ai = makeController(db);

  const noImage = await ai.enrichBatch([{ ...rawProduct, imageUrl: '' }], { marginPercent: 15 });
  assert.equal(noImage[0].ok, false);
  assert.equal(noImage[0].reason, 'missing_image');

  const shortDesc = await ai.enrichBatch([{ ...rawProduct, description: 'Коротко' }], { marginPercent: 15 });
  assert.equal(shortDesc[0].ok, false);
  assert.match(shortDesc[0].reason, /description_too_short/);
});

test('applies margin to the wholesale price (fallback mode)', async () => {
  const db = makeDb();
  const ai = makeController(db);
  const [result] = await ai.enrichBatch([rawProduct], { marginPercent: 15 });

  assert.equal(result.ok, true);
  assert.equal(result.record.aiStatus, 'fallback');
  assert.equal(result.record.costCents, 10000);
  assert.ok(result.record.priceCents >= 11500, 'retail must include the 15% margin');
  assert.equal(Math.floor(result.record.priceCents / 100) % 10, 9, 'price ends with 9');
});

test('uses DeepSeek output when available and caches it', async () => {
  const db = makeDb();
  const ai = makeController(db, { enabled: true });

  const [first] = await ai.enrichBatch([rawProduct], { marginPercent: 15 });
  assert.equal(first.record.title, 'Українська назва 0');
  assert.equal(first.record.aiStatus, 'published');
  assert.equal(first.record.category, 'Навушники');

  const [second] = await ai.enrichBatch([rawProduct], { marginPercent: 15 });
  assert.equal(second.cached, true, 'second run must come from the cache');
  assert.equal(second.record.title, 'Українська назва 0');

  const cached = db.prepare('SELECT COUNT(*) AS c FROM ai_cache').get();
  assert.equal(cached.c, 1);
});

test('falls back to rules when DeepSeek call fails', async () => {
  const db = makeDb();
  const client = {
    enabled: true,
    completeJSON: async () => {
      throw new Error('DeepSeek responded 503');
    },
  };
  const ai = new AIController({ client, config: testConfig(), logger, db });

  const [result] = await ai.enrichBatch([rawProduct], { marginPercent: 15 });
  assert.equal(result.ok, true);
  assert.equal(result.record.aiStatus, 'fallback');
  assert.equal(result.record.category, 'Навушники');
});

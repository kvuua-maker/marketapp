import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, insertProduct, testConfig, logger } from './helpers.js';
import { createAppServer } from '../src/api/server.js';

async function startServer(db) {
  const adapters = [{ id: 'aveopt', name: 'Aveopt' }];
  const ai = { enabled: false };
  const { server } = createAppServer({
    db,
    adapters,
    ai,
    config: testConfig(),
    logger,
    syncTrigger: async () => [],
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('API serves health, categories, catalog and product details', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', title: 'Навушники Test', category: 'Навушники', price_cents: 12900 });
  insertProduct(db, { id: 'aveopt:2', external_id: '2', title: 'Ноутбук Test', category: 'Ноутбуки', price_cents: 259900 });
  const { server, base } = await startServer(db);

  try {
    const health = await (await fetch(`${base}/v1/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.products, 2);
    assert.equal(health.ai.enabled, false);

    const categories = await (await fetch(`${base}/v1/categories`)).json();
    assert.equal(categories.total, 2);
    assert.equal(categories.items.length, 2);

    const catalog = await (await fetch(`${base}/v1/products?limit=1`)).json();
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.total, 2);
    assert.equal(catalog.limit, 1);

    const search = await (await fetch(`${base}/v1/products?q=Ноутбук`)).json();
    assert.equal(search.total, 1);
    assert.equal(search.items[0].title, 'Ноутбук Test');

    const filtered = await (await fetch(`${base}/v1/products?category=${encodeURIComponent('Навушники')}`)).json();
    assert.equal(filtered.total, 1);

    const detail = await (await fetch(`${base}/v1/products/${encodeURIComponent('aveopt:1')}`)).json();
    assert.equal(detail.title, 'Навушники Test');
    assert.equal(detail.priceCents, 12900);
    assert.deepEqual(detail.images, ['https://example.com/1.jpg']);

    const missing = await fetch(`${base}/v1/products/nope`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('API creates an order and exposes its status', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const { server, base } = await startServer(db);

  try {
    const response = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: {
          fullName: 'Олена Шевченко',
          phone: '+380671112233',
          city: 'Київ',
          branch: 'Відділення №12',
        },
        items: [{ productId: 'aveopt:1', qty: 2 }],
      }),
    });
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.payment, 'cod');
    assert.ok(order.orderId.startsWith('MA-'));

    const status = await (await fetch(`${base}/v1/orders/${order.orderId}`)).json();
    assert.equal(status.id, order.orderId);
    assert.equal(status.items.length, 1);
    assert.equal(status.items[0].qty, 2);

    const invalid = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer: {}, items: [] }),
    });
    assert.equal(invalid.status, 422);
    const error = await invalid.json();
    assert.equal(error.error.code, 'validation_error');
  } finally {
    server.close();
  }
});

test('API returns 404 for unknown routes', async () => {
  const db = makeDb();
  const { server, base } = await startServer(db);
  try {
    const response = await fetch(`${base}/v1/unknown`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, insertProduct, testConfig, logger } from './helpers.js';
import { createAppServer } from '../src/api/server.js';
import { run } from '../src/db/database.js';
import { createSession } from '../src/auth/session.js';

function makeUser(db, id = 'usr_test') {
  run(db, 'INSERT INTO users (id, apple_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    `apple-${id}`,
    null,
    null,
    new Date().toISOString(),
  ]);
  return createSession(db, id);
}

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
      headers: { 'content-type': 'application/json', 'x-client-token': 'test-device-token-0001' },
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

    const forbidden = await fetch(`${base}/v1/orders/${order.orderId}`);
    assert.equal(forbidden.status, 404, 'order status must not be readable by another client');

    const statusResponse = await fetch(`${base}/v1/orders/${order.orderId}`, {
      headers: { 'x-client-token': 'test-device-token-0001' },
    });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.id, order.orderId);
    assert.equal(status.items.length, 1);
    assert.equal(status.items[0].qty, 2);

    const invalid = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-token': 'test-device-token-0001' },
      body: JSON.stringify({ customer: {}, items: [] }),
    });
    assert.equal(invalid.status, 422);
    const error = await invalid.json();
    assert.equal(error.error.code, 'validation_error');
  } finally {
    server.close();
  }
});

test('order history requires the device token that created the order', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const { server, base } = await startServer(db);

  try {
    const created = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-token': 'device-alpha-000001' },
      body: JSON.stringify({
        customer: { fullName: 'Олена Шевченко', phone: '+380671112233', city: 'Київ', branch: 'Відділення №12' },
        items: [{ productId: 'aveopt:1', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201);

    const anonymous = await fetch(`${base}/v1/orders?phone=%2B380671112233`);
    assert.equal(anonymous.status, 401);

    const foreign = await fetch(`${base}/v1/orders?phone=%2B380671112233`, {
      headers: { 'x-client-token': 'device-beta-000002' },
    });
    assert.equal(foreign.status, 200);
    const foreignBody = await foreign.json();
    assert.equal(foreignBody.items.length, 0, 'another device must not see the order');

    const own = await fetch(`${base}/v1/orders?phone=%2B380671112233`, {
      headers: { 'x-client-token': 'device-alpha-000001' },
    });
    assert.equal(own.status, 200);
    const ownBody = await own.json();
    assert.equal(ownBody.items.length, 1);
  } finally {
    server.close();
  }
});

test('analytics summary is protected by the admin bearer token', async () => {
  const db = makeDb();
  const { server, base } = await startServer(db);
  try {
    const response = await fetch(`${base}/v1/analytics/summary`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test('profile and cart sync need a session and round-trip', async () => {
  const db = makeDb();
  const token = makeUser(db);
  const { server, base } = await startServer(db);

  try {
    const unauthorized = await fetch(`${base}/v1/profile`);
    assert.equal(unauthorized.status, 401);

    const putProfile = await fetch(`${base}/v1/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        phone: '+380671112233',
        addresses: [{ label: 'Дім', city: 'Київ', branch: 'Відділення №5' }],
      }),
    });
    assert.equal(putProfile.status, 200);

    const profile = await (await fetch(`${base}/v1/profile`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(profile.phone, '+380671112233');
    assert.equal(profile.addresses.length, 1);

    const putCart = await fetch(`${base}/v1/cart`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: 'aveopt:1', qty: 2 }] }),
    });
    assert.equal(putCart.status, 200);

    const cart = await (await fetch(`${base}/v1/cart`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].qty, 2);
  } finally {
    server.close();
  }
});

test('signed-in order history is account based (works from any device)', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const token = makeUser(db);
  const { server, base } = await startServer(db);

  try {
    const created = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer: { fullName: 'Олена Шевченко', phone: '+380671112233', city: 'Київ', branch: 'Відділення №12' },
        items: [{ productId: 'aveopt:1', qty: 1 }],
      }),
    });
    assert.equal(created.status, 201);

    const history = await fetch(`${base}/v1/orders`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(history.status, 200);
    const body = await history.json();
    assert.equal(body.items.length, 1, 'account history must not depend on the device token');
  } finally {
    server.close();
  }
});

test('placing an order empties the account cart for other devices', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const token = makeUser(db);
  const { server, base } = await startServer(db);

  try {
    const put = await fetch(`${base}/v1/cart`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: 'aveopt:1', qty: 2 }] }),
    });
    assert.equal(put.status, 200);

    const created = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer: { fullName: 'Олена Шевченко', phone: '+380671112233', city: 'Київ', branch: 'Відділення №12' },
        items: [{ productId: 'aveopt:1', qty: 2 }],
      }),
    });
    assert.equal(created.status, 201);

    const cart = await (await fetch(`${base}/v1/cart`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(cart.items.length, 0, 'the ordered items must leave the synced cart');
    assert.ok(cart.updatedAt, 'an empty cart must carry a timestamp so clients treat it as authoritative');
  } finally {
    server.close();
  }
});

test('a customer can cancel an order that has not shipped', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const { server, base } = await startServer(db);
  const device = 'device-cancel-000001';

  try {
    const created = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-token': device },
      body: JSON.stringify({
        customer: { fullName: 'Олена Шевченко', phone: '+380671112233', city: 'Київ', branch: 'Відділення №12' },
        items: [{ productId: 'aveopt:1', qty: 1 }],
      }),
    });
    const order = await created.json();

    const cancelled = await fetch(`${base}/v1/orders/${order.orderId}/cancel`, {
      method: 'POST',
      headers: { 'x-client-token': device },
    });
    assert.equal(cancelled.status, 200);
    const body = await cancelled.json();
    assert.equal(body.status, 'cancelled');

    const again = await fetch(`${base}/v1/orders/${order.orderId}/cancel`, {
      method: 'POST',
      headers: { 'x-client-token': device },
    });
    assert.equal(again.status, 400);

    const foreign = await fetch(`${base}/v1/orders/${order.orderId}/cancel`, {
      method: 'POST',
      headers: { 'x-client-token': 'device-other-000002' },
    });
    assert.equal(foreign.status, 404);
  } finally {
    server.close();
  }
});

test('an order that already shipped cannot be cancelled', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 10 });
  const { server, base } = await startServer(db);
  const device = 'device-shipped-000001';

  try {
    const created = await fetch(`${base}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-token': device },
      body: JSON.stringify({
        customer: { fullName: 'Олена Шевченко', phone: '+380671112233', city: 'Київ', branch: 'Відділення №12' },
        items: [{ productId: 'aveopt:1', qty: 1 }],
      }),
    });
    const order = await created.json();
    run(db, "UPDATE orders SET status = 'shipped' WHERE id = ?", [order.orderId]);

    const response = await fetch(`${base}/v1/orders/${order.orderId}/cancel`, {
      method: 'POST',
      headers: { 'x-client-token': device },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error.message, /вже в дорозі/);
  } finally {
    server.close();
  }
});

test('apple sign-in rejects a malformed identity token', async () => {
  const db = makeDb();
  const { server, base } = await startServer(db);
  try {
    const response = await fetch(`${base}/v1/auth/apple`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identityToken: 'not-a-jwt' }),
    });
    assert.equal(response.status, 422);
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

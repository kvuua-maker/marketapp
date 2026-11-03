import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, insertProduct, testConfig, logger } from './helpers.js';
import { createOrder, normalizePhone, validateCustomer } from '../src/orders/router.js';
import { get } from '../src/db/database.js';

function fakeAdapter(id, behaviour = 'sent') {
  return {
    id,
    name: id.toUpperCase(),
    async placeOrder({ order }) {
      if (behaviour === 'unsupported') {
        const error = new Error('no api');
        error.code = 'order_api_unsupported';
        throw error;
      }
      return { status: 'sent', ref: `api-${order.id}` };
    },
  };
}

test('normalizePhone accepts Ukrainian formats', () => {
  assert.equal(normalizePhone('+380 67 123 45 67'), '+380671234567');
  assert.equal(normalizePhone('380671234567'), '+380671234567');
  assert.equal(normalizePhone('0671234567'), '+380671234567');
  assert.equal(normalizePhone('12345'), null);
});

test('validateCustomer rejects incomplete data', () => {
  assert.throws(() => validateCustomer({ fullName: 'Іван', phone: '0671234567', city: 'Київ', branch: '1' }));
  assert.throws(() => validateCustomer({ fullName: 'Іван Петренко', phone: '000', city: 'Київ', branch: 'Відділення 1' }));
  const ok = validateCustomer({
    fullName: 'Іван Петренко',
    phone: '0671234567',
    city: 'Київ',
    branch: 'Відділення №1',
  });
  assert.equal(ok.phone, '+380671234567');
});

test('createOrder routes items to their supplier via API', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', supplier_id: 'aveopt', stock: 3 });
  insertProduct(db, { id: 'lugi:9', supplier_id: 'lugi', external_id: '9', stock: 4 });

  const result = await createOrder({
    db,
    adapters: [fakeAdapter('aveopt'), fakeAdapter('lugi')],
    config: testConfig(),
    logger,
    payload: {
      customer: { fullName: 'Іван Петренко', phone: '0671234567', city: 'Київ', branch: 'Відділення №1' },
      items: [
        { productId: 'aveopt:1', qty: 2 },
        { productId: 'lugi:9', qty: 1 },
      ],
    },
  });

  assert.equal(result.status, 'routed');
  assert.equal(result.payment, 'cod');
  assert.equal(result.suppliers.length, 2);
  assert.equal(result.totalCents, 12900 * 2 + 12900);

  const items = db.prepare('SELECT supplier_order_status FROM order_items WHERE order_id = ?').all(result.orderId);
  assert.ok(items.every((item) => item.supplier_order_status === 'sent'));
});

test('createOrder falls back to the email outbox when supplier API is missing', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', supplier_id: 'aveopt' });

  const result = await createOrder({
    db,
    adapters: [fakeAdapter('aveopt', 'unsupported')],
    config: testConfig(),
    logger,
    payload: {
      customer: { fullName: 'Марія Коваль', phone: '+380931112233', city: 'Львів', branch: 'Відділення №5' },
      items: [{ productId: 'aveopt:1', qty: 1 }],
    },
  });

  assert.equal(result.status, 'routed_email');
  const outbox = db.prepare('SELECT * FROM outbox WHERE order_id = ?').all(result.orderId);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].channel, 'email');
  assert.match(outbox[0].body, /післяплата/i);
  assert.match(outbox[0].body, /Нової Пошти/);
});

test('createOrder rejects out-of-stock and unknown products', async () => {
  const db = makeDb();
  insertProduct(db, { id: 'aveopt:1', stock: 0 });

  await assert.rejects(
    createOrder({
      db,
      adapters: [fakeAdapter('aveopt')],
      config: testConfig(),
      logger,
      payload: {
        customer: { fullName: 'Іван Петренко', phone: '0671234567', city: 'Київ', branch: 'Відділення №1' },
        items: [{ productId: 'aveopt:1', qty: 1 }],
      },
    }),
    /відсутній на складі/,
  );

  await assert.rejects(
    createOrder({
      db,
      adapters: [],
      config: testConfig(),
      logger,
      payload: {
        customer: { fullName: 'Іван Петренко', phone: '0671234567', city: 'Київ', branch: 'Відділення №1' },
        items: [{ productId: 'missing:1', qty: 1 }],
      },
    }),
    /не знайдено/,
  );

  assert.equal(get(db, 'SELECT COUNT(*) AS c FROM orders').c, 0);
});

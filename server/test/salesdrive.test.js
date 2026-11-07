import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../src/db/database.js';
import { buildSalesDriveOrder, normalizePhone, splitName } from '../src/salesdrive/payload.js';
import { SalesDriveClient } from '../src/salesdrive/client.js';
import { mapStatus, extractTtn, handleSalesDriveWebhook } from '../src/salesdrive/webhook.js';

const order = { id: 'MA-1001' };
const customer = {
  fullName: 'Шевчук Петро Іванович',
  phone: '+380 (67) 123-45-67',
  city: 'Київ',
  branch: 'Відділення №17',
  comment: 'подзвонити',
};
const items = [
  { productId: 'dropt_123', title: 'Кронштейн HDL-117B', qty: 1, unitPriceCents: 63_900 },
];

test('payload carries the retail price, normalized phone and NP data', () => {
  const payload = buildSalesDriveOrder({ order, customer, items });
  assert.equal(payload.externalId, 'MA-1001');
  assert.equal(payload.phone, '380671234567');
  assert.equal(payload.lName, 'Шевчук');
  assert.equal(payload.fName, 'Петро');
  assert.equal(payload.mName, 'Іванович');
  assert.equal(payload.products[0].costPerItem, 639, 'sale price, not the drop price');
  assert.equal(payload.products[0].amount, 1);
  assert.equal(payload.novaposhta.city, 'Київ');
  assert.equal(payload.novaposhta.WarehouseNumber, 'Відділення №17');
  assert.equal(payload.novaposhta.payer, 'recipient');
});

test('phone and name validation rejects bad input', () => {
  assert.equal(normalizePhone('0671234567'), '380671234567');
  assert.equal(normalizePhone('abc'), null);
  assert.deepEqual(splitName('Іван Петренко'), { lName: 'Іван', fName: 'Петренко', mName: '' });
  assert.throws(() => buildSalesDriveOrder({ order, customer: { ...customer, phone: '123' }, items }), /телефон/i);
  assert.throws(() => buildSalesDriveOrder({ order, customer: { ...customer, fullName: 'X' }, items }), /прізвище/i);
});

test('status mapping and TTN extraction', () => {
  assert.equal(mapStatus(2), 'delivered');
  assert.equal(mapStatus(3), 'cancelled');
  assert.equal(mapStatus(9), null);
  assert.equal(mapStatus(9, { 9: 'routed' }), 'routed');
  assert.equal(extractTtn({ ord_delivery_data: [{ ttn: '20451234567890' }] }), '20451234567890');
  assert.equal(extractTtn({ novaposhta: { ttn: '20450000000001' } }), '20450000000001');
  assert.equal(extractTtn({}), null);
});

test('webhook updates the order status and TTN, and is audited', () => {
  const db = openDatabase(':memory:');
  db.prepare(
    `INSERT INTO orders (id, customer_json, total_cents, status, created_at)
     VALUES ('MA-1001', '{}', 63900, 'routed_email', '2026-11-07T10:00:00Z')`,
  ).run();

  const result = handleSalesDriveWebhook({
    db,
    config: { salesdrive: { statusMap: {} } },
    logger: null,
    body: {
      info: { webhookType: 'order', webhookEvent: 'status_change' },
      data: { externalId: 'MA-1001', statusId: 2, ord_delivery_data: [{ ttn: '20451234567890' }] },
    },
  });

  assert.equal(result.matched, true);
  assert.equal(result.status, 'delivered');
  const row = db.prepare('SELECT status, ttn FROM orders WHERE id = ?').get('MA-1001');
  assert.equal(row.status, 'delivered');
  assert.equal(row.ttn, '20451234567890');
  const event = db.prepare('SELECT result FROM webhook_events WHERE external_id = ?').get('MA-1001');
  assert.equal(event.result, 'status:delivered');
});

test('webhook for an unknown order is recorded, not crashed', () => {
  const db = openDatabase(':memory:');
  const result = handleSalesDriveWebhook({
    db,
    config: { salesdrive: { statusMap: {} } },
    logger: null,
    body: { info: {}, data: { externalId: 'MA-404', statusId: 2 } },
  });
  assert.equal(result.matched, false);
  const event = db.prepare('SELECT result FROM webhook_events WHERE external_id = ?').get('MA-404');
  assert.equal(event.result, 'order_not_found');
});

test('client retries 5xx and never retries 4xx', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/handler/' && hits === 1) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"boom"}');
      return;
    }
    if (req.url === '/bad') {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end('{"error":"validation"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"success":true,"data":{"id":777}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const client = new SalesDriveClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', retries: 1 });

  const created = await client.createOrder({ externalId: 'MA-1' });
  assert.equal(created.id, 777);

  hits = 0;
  await assert.rejects(() => client.request('/bad', { body: {} }), /HTTP 422/);
  assert.equal(hits, 1, '4xx is not retried');

  await new Promise((resolve) => server.close(resolve));
});

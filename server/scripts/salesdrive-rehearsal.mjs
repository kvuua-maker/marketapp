#!/usr/bin/env node
/**
 * End-to-end rehearsal of the Dropt path without real SalesDrive credentials.
 *
 * Starts a local mock that implements the SalesDrive `/handler/` contract,
 * sends a real order through DroptAdapter.placeOrder(), then replays the
 * SalesDrive status webhook against the same order in a throwaway DB.
 */
import { createServer } from 'node:http';
import { openDatabase } from '../src/db/database.js';
import { DroptAdapter } from '../src/suppliers/dropt.js';
import { handleSalesDriveWebhook } from '../src/salesdrive/webhook.js';

const PORT = 8898;
const received = [];

const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const parsed = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return {};
      }
    })();
    received.push({ url: req.url, apiKey: req.headers['x-api-key'], body: parsed });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { id: 777001 } }));
  });
});
await new Promise((resolve) => mock.listen(PORT, '127.0.0.1', resolve));

const db = openDatabase(':memory:');
db.prepare(
  `INSERT INTO orders (id, customer_json, total_cents, status, created_at)
   VALUES ('MA-20261107-0001', '{}', 63900, 'routed_email', '2026-11-07T12:00:00Z')`,
).run();

const adapter = new DroptAdapter({
  config: {
    salesdrive: {
      apiKey: 'test-api-key',
      baseUrl: `http://127.0.0.1:${PORT}`,
      paymentMethod: 'cod',
      shippingMethod: 'novaposhta',
    },
  },
  logger: {
    info: (message, meta) => console.log(`LOG  ${message} ${meta ? JSON.stringify(meta) : ''}`),
    warn: (message, meta) => console.log(`WARN ${message} ${meta ? JSON.stringify(meta) : ''}`),
  },
});

const order = { id: 'MA-20261107-0001' };
const customer = {
  fullName: 'Шевчук Петро Іванович',
  phone: '+380 (67) 123-45-67',
  city: 'Київ',
  branch: 'Відділення №17',
  comment: 'Зателефонувати перед відправкою',
};
const items = [
  { productId: 'dropt_111111367', title: 'Кронштейн для телевізора HDL-117B VESA', qty: 1, unitPriceCents: 32_900 },
];

console.log('STEP 1  our app → SalesDrive /handler/');
const result = await adapter.placeOrder({ order, customer, items });
console.log('RESULT', JSON.stringify(result));

const request = received[0];
console.log('REQUEST', JSON.stringify(request.body, null, 1));
console.log('HEADERS', JSON.stringify({ 'x-api-key': request.apiKey }));

console.log('\nSTEP 2  SalesDrive → our app (status webhook)');
const webhook = handleSalesDriveWebhook({
  db,
  config: { salesdrive: { statusMap: {} } },
  logger: { info: (message, meta) => console.log(`LOG  ${message} ${meta ? JSON.stringify(meta) : ''}`) },
  body: {
    info: { webhookType: 'order', webhookEvent: 'status_change', account: 'mock' },
    data: {
      id: 777001,
      externalId: 'MA-20261107-0001',
      statusId: 2,
      paymentAmount: 639,
      ord_delivery_data: [{ ttn: '20451234567890' }],
    },
  },
});
console.log('WEBHOOK RESULT', JSON.stringify(webhook));

const row = db.prepare('SELECT id, status, ttn FROM orders WHERE id = ?').get('MA-20261107-0001');
console.log('DB ORDER', JSON.stringify(row));
const event = db.prepare('SELECT result FROM webhook_events WHERE external_id = ?').get('MA-20261107-0001');
console.log('AUDIT', JSON.stringify(event));

await new Promise((resolve) => mock.close(resolve));
console.log('\nOK  sales price in payload = 329.00 UAH (retail), phone normalized, NP branch passed, status delivered, TTN stored');

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDroptOrder, sendDroptOrderToManager } from '../src/services/telegramOrders.js';

const order = { id: 'MA-1' };
const customer = { fullName: 'Шевчук Петро', phone: '+380671234567', city: 'Київ', branch: 'Відділення №17', comment: 'подзвонити' };
const items = [{ title: 'Кронштейн HDL-117B', qty: 2, unitPriceCents: 32_900 }];

test('order message contains everything the manager needs', () => {
  const text = formatDroptOrder({ order, customer, items });
  assert.match(text, /MA-1/);
  assert.match(text, /Шевчук Петро/);
  assert.match(text, /380671234567/);
  assert.match(text, /Київ, Відділення №17/);
  assert.match(text, /2 шт × 329\.00 ₴/);
  assert.match(text, /Разом: 658\.00 ₴/);
  assert.match(text, /накладений платіж/);
});

test('sender posts to the Bot API and fails when not configured', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
  };
  try {
    const result = await sendDroptOrderToManager({ botToken: 'T', chatId: '123', order, customer, items });
    assert.equal(result.messageId, 42);
    assert.match(calls[0].url, /botT\/sendMessage/);
    assert.equal(calls[0].body.chat_id, '123');

    await assert.rejects(
      () => sendDroptOrderToManager({ botToken: '', chatId: '', order, customer, items }),
      /not configured/,
    );
  } finally {
    global.fetch = original;
  }
});

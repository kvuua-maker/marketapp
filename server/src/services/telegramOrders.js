/**
 * Variant C: send a Dropt order to the supplier's manager via Telegram.
 *
 * Dropt has no public order API and their CRM integrations (LP-CRM,
 * SalesDrive) are paid. A Telegram bot is free and the manager receives a
 * ready-to-enter order in a fixed format.
 *
 * Requires TELEGRAM_BOT_TOKEN and DROPT_MANAGER_CHAT_ID. The manager must
 * press /start in the bot once, otherwise Telegram forbids the bot to write.
 */
import { AppError } from '../core/errors.js';

const uah = (cents) => `${(cents / 100).toFixed(2)} ₴`;

/** Pure formatter — unit tested. */
export function formatDroptOrder({ order, customer, items, totalCents }) {
  const total = totalCents ?? items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
  const lines = [
    '🛒 Нове замовлення MarketApp',
    `№ ${order.id}`,
    '',
    `Покупець: ${customer.fullName}`,
    `Телефон: ${customer.phone}`,
    `Доставка: Нова Пошта, ${customer.city}, ${customer.branch}`,
    'Оплата: накладений платіж (післяплата)',
    '',
    'Товари:',
    ...items.map(
      (item) =>
        `• ${item.title} — ${item.qty} шт × ${uah(item.unitPriceCents)} = ${uah(item.unitPriceCents * item.qty)}`,
    ),
    '',
    `Разом: ${uah(total)}`,
  ];
  if (customer.comment) lines.push('', `Коментар: ${customer.comment}`);
  lines.push('', 'Ціни — роздрібні (ціна продажу для Dropt). Просимо підтвердити та надіслати ТТН.');
  return lines.join('\n').slice(0, 3800);
}

export async function sendDroptOrderToManager({ botToken, chatId, order, customer, items, totalCents, logger }) {
  if (!botToken || !chatId) {
    const error = new AppError('Dropt Telegram dispatcher is not configured', {
      code: 'dropt_telegram_not_configured',
      status: 503,
    });
    throw error;
  }

  const text = formatDroptOrder({ order, customer, items, totalCents });
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new AppError('Telegram rejected the order message', {
      code: 'dropt_telegram_failed',
      status: 502,
      details: { status: response.status, description: data?.description },
    });
  }
  logger?.info('dropt order sent to manager via Telegram', { orderId: order.id, chatId });
  return { messageId: data?.result?.message_id ?? null };
}

/** Generic supplier order text (Aveopt and others). */
export function formatSupplierOrder({ supplierName, order, customer, items, totalCents, note = '' }) {
  const total = totalCents ?? items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
  const lines = [
    `🛒 Нове замовлення MarketApp — ${supplierName}`,
    `№ ${order.id}`,
    '',
    `Покупець: ${customer.fullName}`,
    `Телефон: ${customer.phone}`,
    `Доставка: Нова Пошта, ${customer.city}, ${customer.branch}`,
    'Оплата: накладений платіж (післяплата)',
    '',
    'Товари:',
    ...items.map((item) => `• ${item.title} — ${item.qty} шт × ${uah(item.unitPriceCents)} = ${uah(item.unitPriceCents * item.qty)}`),
    '',
    `Разом: ${uah(total)}`,
  ];
  if (customer.comment) lines.push('', `Коментар: ${customer.comment}`);
  if (note) lines.push('', note);
  return lines.join('\n').slice(0, 3800);
}

export async function sendOrderToChat({ botToken, chatId, text, logger }) {
  if (!botToken || !chatId) throw new Error('Telegram chat is not configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(`Telegram rejected: ${data?.description ?? response.status}`);
  logger?.info('order sent to Telegram chat', { chatId, messageId: data?.result?.message_id });
  return { messageId: data?.result?.message_id ?? null };
}

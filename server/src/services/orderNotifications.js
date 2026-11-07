/**
 * Owner notifications about new orders.
 *
 * Email is optional: with EMAIL_PROVIDER=outbox the supplier letter stays in
 * the database, while every order is pushed to the owner's Telegram chat.
 */
const uah = (cents) => `${(cents / 100).toFixed(2)} ₴`;

export function formatNewOrder({ orderId, totalCents, items = [], customer = {}, suppliers = [] }) {
  const lines = [
    '🆕 Нове замовлення MarketApp',
    `№ ${orderId}`,
    `Сума: ${uah(totalCents)}`,
    '',
    `Покупець: ${customer.fullName ?? '—'}`,
    `Телефон: ${customer.phone ?? '—'}`,
    `Доставка: ${customer.city ?? '—'}, ${customer.branch ?? '—'}`,
    `Постачальник: ${suppliers.join(', ') || '—'}`,
    '',
    'Товари:',
    ...items.map((item) => `• ${item.title} — ${item.qty} шт × ${uah(item.unitPriceCents)}`),
  ];
  if (customer.comment) lines.push('', `Коментар: ${customer.comment}`);
  lines.push('', 'Статус доставки постачальнику — у адмінці замовлень.');
  return lines.join('\n').slice(0, 3800);
}

export async function notifyOwnerNewOrder({ config, logger, orderId, totalCents, items, customer, suppliers }) {
  const token = config?.notifications?.telegram?.token;
  const chatId = config?.notifications?.telegram?.chatId;
  if (!token || !chatId) return false;

  const text = formatNewOrder({ orderId, totalCents, items, customer, suppliers });
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      logger?.warn('owner order notification rejected', { orderId, status: response.status });
      return false;
    }
    logger?.info('owner notified about order', { orderId, messageId: data?.result?.message_id });
    return true;
  } catch (error) {
    logger?.warn('owner order notification failed', { orderId, error: error.message });
    return false;
  }
}

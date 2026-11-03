import { run, all, get } from '../db/database.js';
import { formatUah } from '../domain/pricing.js';

/** Builds the supplier-facing email with everything needed for Nova Poshta COD delivery. */
export function composeSupplierEmail({ order, items, customer, supplierName }) {
  const lines = [
    `Нове замовлення MarketApp № ${order.id}`,
    `Постачальник: ${supplierName}`,
    '',
    'ТОВАРИ:',
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.title} — ${item.qty} шт. × ${formatUah(item.unitPriceCents)} = ${formatUah(item.unitPriceCents * item.qty)}`,
    ),
    '',
    `Сума: ${formatUah(items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0))}`,
    '',
    'ОТРИМУВАЧ (Нова Пошта, післяплата):',
    `ПІБ: ${customer.fullName}`,
    `Телефон: ${customer.phone}`,
    `Місто: ${customer.city}`,
    `Відділення: ${customer.branch}`,
    customer.comment ? `Коментар: ${customer.comment}` : '',
    '',
    'Оплата: післяплата (накладений платіж) при отриманні у відділенні Нової Пошти.',
    'Прохання: відправити замовлення та надіслати ТТН у відповідь на цей лист.',
  ].filter(Boolean);

  return {
    subject: `MarketApp: замовлення ${order.id} (${customer.city}, НП післяплата)`,
    text: lines.join('\n'),
  };
}

export function enqueueOutbox(db, { orderId, supplierId, channel = 'email', to, subject, body }) {
  return run(
    db,
    `INSERT INTO outbox (order_id, supplier_id, channel, to_addr, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
    {
      1: orderId,
      2: supplierId,
      3: channel,
      4: to ?? '',
      5: subject ?? '',
      6: body ?? '',
      7: new Date().toISOString(),
    },
  ).lastInsertRowid;
}

async function sendViaResend({ apiKey, from, to, subject, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Delivers queued supplier emails.
 * EMAIL_PROVIDER=outbox keeps them in the DB (safe default for demos/CI).
 * EMAIL_PROVIDER=resend actually sends them.
 */
export async function deliverOutbox(db, { config, logger, limit = 20 }) {
  const provider = config.orders.emailProvider;
  const pending = all(db, "SELECT * FROM outbox WHERE status = 'queued' ORDER BY id ASC LIMIT ?", { 1: limit });
  if (pending.length === 0) return { sent: 0, failed: 0, pending: 0 };
  if (provider !== 'resend' || !config.orders.resendApiKey) {
    logger.info('outbox delivery skipped (provider not configured)', { pending: pending.length, provider });
    return { sent: 0, failed: 0, pending: pending.length };
  }

  let sent = 0;
  let failed = 0;
  for (const entry of pending) {
    try {
      await sendViaResend({
        apiKey: config.orders.resendApiKey,
        from: config.orders.emailFrom,
        to: entry.to_addr,
        subject: entry.subject,
        text: entry.body,
      });
      run(db, "UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?", {
        1: new Date().toISOString(),
        2: entry.id,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      run(db, "UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", {
        1: String(error.message).slice(0, 300),
        2: entry.id,
      });
      logger.warn('outbox delivery failed', { id: entry.id, error: error.message });
    }
  }
  return { sent, failed, pending: pending.length - sent - failed };
}

export function outboxForOrder(db, orderId) {
  return all(db, 'SELECT id, supplier_id, channel, to_addr, subject, status, created_at, sent_at FROM outbox WHERE order_id = ?', {
    1: orderId,
  });
}

export function getOrder(db, orderId) {
  const order = get(db, 'SELECT * FROM orders WHERE id = ?', { 1: orderId });
  if (!order) return null;
  const items = all(db, 'SELECT * FROM order_items WHERE order_id = ?', { 1: orderId });
  return { order, items, outbox: outboxForOrder(db, orderId) };
}

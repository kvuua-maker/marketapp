/**
 * SalesDrive → MarketApp status webhook.
 *
 * SalesDrive posts the order JSON when an order is created or its status
 * changes (Установки → Інші сервіси → Webhook). The order is matched by
 * externalId, which we set to our own order id when creating it.
 */
import { get, run } from '../db/database.js';
import { AppError } from '../core/errors.js';

/** Defaults follow SalesDrive's status categories (1 process, 2 sale, 3 fail, 4 deleted). */
export const DEFAULT_STATUS_MAP = {
  1: 'processing',
  2: 'delivered',
  3: 'cancelled',
  4: 'cancelled',
};

export function mapStatus(statusId, statusMap = {}) {
  const key = String(statusId ?? '');
  const map = { ...DEFAULT_STATUS_MAP, ...statusMap };
  return map[key] ?? null;
}

/** SalesDrive puts delivery data either in ord_delivery_data or novaposhta. */
export function extractTtn(data) {
  const candidates = [];
  if (Array.isArray(data?.ord_delivery_data)) {
    for (const entry of data.ord_delivery_data) {
      if (entry?.ttn) candidates.push(String(entry.ttn));
    }
  }
  if (data?.novaposhta?.ttn) candidates.push(String(data.novaposhta.ttn));
  const ttn = candidates.find((value) => /^\d{10,25}$/.test(value));
  return ttn ?? null;
}

export function recordWebhookEvent(db, { source, externalId, event, payload, result }) {
  run(
    db,
    `INSERT INTO webhook_events (source, external_id, event, payload_json, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [source, externalId ?? null, event ?? null, JSON.stringify(payload ?? {}).slice(0, 20_000), result, new Date().toISOString()],
  );
}

export function handleSalesDriveWebhook({ db, body, config, logger }) {
  const data = body?.data ?? body ?? {};
  const externalId = data.externalId ? String(data.externalId) : null;
  const event = body?.info?.webhookEvent ?? body?.info?.webhookType ?? 'order';

  if (!externalId) {
    recordWebhookEvent(db, { source: 'salesdrive', externalId: null, event, payload: body, result: 'missing_external_id' });
    throw new AppError('externalId відсутній', { code: 'webhook_bad_payload', status: 400 });
  }

  const order = get(db, 'SELECT id, status, ttn FROM orders WHERE id = ?', [externalId]);
  if (!order) {
    recordWebhookEvent(db, { source: 'salesdrive', externalId, event, payload: body, result: 'order_not_found' });
    logger?.warn('salesdrive webhook: order not found', { externalId });
    return { orderId: externalId, matched: false, reason: 'order_not_found' };
  }

  const mapped = mapStatus(data.statusId, config.salesdrive.statusMap);
  const ttn = extractTtn(data);
  const now = new Date().toISOString();

  if (mapped) {
    run(
      db,
      'UPDATE orders SET status = ?, ttn = COALESCE(?, ttn), ttn_status = ? WHERE id = ?',
      [mapped, ttn, ttn ? 'created' : order.ttn ? 'known' : null, externalId],
    );
  } else if (ttn) {
    run(db, 'UPDATE orders SET ttn = ?, ttn_status = ? WHERE id = ?', [ttn, 'created', externalId]);
  }

  recordWebhookEvent(db, {
    source: 'salesdrive',
    externalId,
    event,
    payload: body,
    result: mapped ? `status:${mapped}` : ttn ? 'ttn_only' : 'unmapped_status',
  });

  logger?.info('salesdrive webhook processed', {
    orderId: externalId,
    statusId: data.statusId ?? null,
    mapped: mapped ?? 'unmapped',
    ttn: ttn ?? null,
    at: now,
  });

  return { orderId: externalId, matched: true, status: mapped ?? order.status, ttn: ttn ?? order.ttn ?? null };
}

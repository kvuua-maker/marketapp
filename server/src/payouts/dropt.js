/**
 * Dropt payout register.
 *
 * Dropt has no public API for wallet/withdrawals (their cabinet exposes
 * «Налаштування → Реквізити» and «Фінанси → Вивести кошти» only). Their payout
 * balance lives in their cabinet, so we can only reconstruct what *we* earned
 * on Dropt orders: sale price minus the supplier's drop price.
 *
 * The report is therefore an estimate of the money Dropt should transfer:
 *  • pending   — order younger than the hold period (money not yet released)
 *  • available — older than the hold period and not cancelled
 */
import { all } from '../db/database.js';

export function buildDroptPayoutReport(db, { supplierId = 'dropt', holdDays = 14, now = new Date() } = {}) {
  const rows = all(
    db,
    `SELECT o.id, o.created_at, o.status, i.qty, i.unit_price_cents,
            i.title_snapshot, i.product_id, p.cost_cents
       FROM orders o
       JOIN order_items i ON i.order_id = o.id
       LEFT JOIN products p ON p.id = i.product_id
      WHERE i.supplier_id = ? AND o.status != 'cancelled'
      ORDER BY o.created_at`,
    [supplierId],
  );

  const orders = new Map();
  for (const row of rows) {
    const costCents = Number.isFinite(row.cost_cents) ? row.cost_cents : null;
    const entry = orders.get(row.id) ?? {
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      revenueCents: 0,
      costCents: 0,
      marginCents: 0,
      missingCost: false,
      items: [],
    };
    const revenue = row.unit_price_cents * row.qty;
    const cost = costCents === null ? 0 : costCents * row.qty;
    entry.revenueCents += revenue;
    entry.costCents += cost;
    entry.marginCents += revenue - cost;
    if (costCents === null) entry.missingCost = true;
    entry.items.push({ productId: row.product_id, title: row.title_snapshot, qty: row.qty });
    orders.set(row.id, entry);
  }

  const holdMs = holdDays * 24 * 60 * 60 * 1000;
  const list = [...orders.values()].map((order) => {
    const createdAt = new Date(order.createdAt);
    const availableAt = new Date(createdAt.getTime() + holdMs);
    return {
      ...order,
      availableAt: availableAt.toISOString(),
      state: availableAt <= now ? 'available' : 'pending',
    };
  });

  const available = list.filter((order) => order.state === 'available');
  const pending = list.filter((order) => order.state === 'pending');
  const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

  return {
    supplierId,
    holdDays,
    generatedAt: now.toISOString(),
    orders: list,
    totals: {
      availableCents: sum(available, 'marginCents'),
      pendingCents: sum(pending, 'marginCents'),
      revenueCents: sum(list, 'revenueCents'),
      costCents: sum(list, 'costCents'),
      marginCents: sum(list, 'marginCents'),
      availableOrders: available.length,
      pendingOrders: pending.length,
    },
  };
}

const uah = (cents) => `${(cents / 100).toFixed(2)} ₴`;

export function formatPayoutReport(report) {
  const lines = [
    `💸 Dropt payouts (hold ${report.holdDays}d)`,
    `available: ${uah(report.totals.availableCents)} (${report.totals.availableOrders} orders)`,
    `pending:   ${uah(report.totals.pendingCents)} (${report.totals.pendingOrders} orders)`,
    `revenue ${uah(report.totals.revenueCents)} − cost ${uah(report.totals.costCents)} = margin ${uah(report.totals.marginCents)}`,
  ];

  const recent = [...report.orders].reverse().slice(0, 10);
  if (recent.length > 0) {
    lines.push('');
    for (const order of recent) {
      lines.push(
        `${order.id} | ${order.createdAt.slice(0, 10)} | ${order.state} | margin ${uah(order.marginCents)}`,
      );
    }
  }
  return lines.join('\n');
}

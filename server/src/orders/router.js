import { randomUUID } from 'node:crypto';
import { get, all, run, transaction } from '../db/database.js';
import { ValidationError, NotFoundError } from '../core/errors.js';
import { composeSupplierEmail, enqueueOutbox } from './outbox.js';
import { normPhone } from '../domain/normalize.js';

/**
 * Items with a single unit left are checked against the supplier right before
 * the order is routed — the catalog can be up to 90 minutes stale.
 */
async function revalidateLowStock({ products, adapterById, logger }) {
  for (const product of products) {
    if (product.stock > 1) continue;
    const adapter = adapterById.get(product.supplier_id);
    if (!adapter?.checkStock) continue;

    try {
      const stock = await Promise.race([
        adapter.checkStock(product.external_id),
        new Promise((_, reject) => setTimeout(() => reject(new Error('stock check timeout')), 5000)),
      ]);
      if (Number(stock) <= 0) {
        throw new ValidationError(`Товар «${product.title}» щойно закінчився. Оновіть кошик.`);
      }
      product.stock = Number(stock);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.warn('live stock check failed, continuing with cached value', {
        productId: product.id,
        error: error.message,
      });
    }
  }
}

const PHONE_UA = /^(?:\+?38)?0(\d{9})$/;
const MAX_QTY_PER_ITEM = 10;

export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  const match = digits.match(PHONE_UA);
  if (!match) return null;
  return `+380${match[1]}`;
}

export function validateCustomer(input) {
  const errors = [];
  const fullName = String(input?.fullName ?? '').trim();
  const phone = normalizePhone(input?.phone);
  const city = String(input?.city ?? '').trim();
  const branch = String(input?.branch ?? '').trim();
  const comment = String(input?.comment ?? '').trim().slice(0, 500);

  if (fullName.length < 5 || !fullName.includes(' ')) {
    errors.push({ field: 'fullName', message: 'Вкажіть прізвище та імʼя' });
  }
  if (!phone) errors.push({ field: 'phone', message: 'Формат телефону: +380XXXXXXXXX' });
  if (city.length < 2) errors.push({ field: 'city', message: 'Вкажіть місто' });
  if (branch.length < 3) errors.push({ field: 'branch', message: 'Вкажіть відділення Нової Пошти' });

  if (errors.length > 0) throw new ValidationError('Некоректні дані отримувача', errors);

  return { fullName, phone, city, branch, comment };
}

function validateItems(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError('Кошик порожній', [{ field: 'items', message: 'Додайте хоча б один товар' }]);
  }
  if (input.length > 50) {
    throw new ValidationError('Забагато позицій у замовленні');
  }
  return input.map((item) => {
    const productId = String(item?.productId ?? '').trim();
    const qty = Number(item?.qty ?? item?.quantity ?? 0);
    if (!productId) throw new ValidationError('Не вказано товар', [{ field: 'productId' }]);
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY_PER_ITEM) {
      throw new ValidationError(`Некоректна кількість для ${productId}`);
    }
    return { productId, qty };
  });
}

function loadProducts(db, items) {
  const products = [];
  for (const item of items) {
    const product = get(db, 'SELECT * FROM products WHERE id = ?', { 1: item.productId });
    if (!product) throw new NotFoundError(`Товар не знайдено: ${item.productId}`);
    if (product.stock <= 0) {
      throw new ValidationError(`Товар відсутній на складі: ${product.title}`);
    }
    products.push({ ...product, qty: item.qty });
  }
  return products;
}

/**
 * Creates an order and routes every line to its supplier automatically.
 * No owner interaction: API order or supplier email queued in the outbox.
 */
export async function createOrder({ db, adapters, config, logger, payload, novaPoshta }) {
  const customer = validateCustomer(payload?.customer);
  const items = validateItems(payload?.items);
  const products = loadProducts(db, items);

  const totalCents = products.reduce((sum, product) => sum + product.price_cents * product.qty, 0);
  const orderId = `MA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const now = new Date().toISOString();

  const groups = new Map();
  for (const product of products) {
    if (!groups.has(product.supplier_id)) groups.set(product.supplier_id, []);
    groups.get(product.supplier_id).push(product);
  }

  transaction(db, () => {
    run(
      db,
      `INSERT INTO orders (id, client_order_id, customer_json, phone_norm, total_cents, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'UAH', 'routing', ?)`,
      {
        1: orderId,
        2: payload?.clientOrderId ? String(payload.clientOrderId) : null,
        3: JSON.stringify(customer),
        4: normPhone(customer.phone),
        5: totalCents,
        6: now,
      },
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, supplier_id, title_snapshot, qty, unit_price_cents, supplier_order_status)
       VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    );
    for (const product of products) {
      insertItem.run(orderId, product.id, product.supplier_id, product.title, product.qty, product.price_cents);
    }
  });

  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  await revalidateLowStock({ products, adapterById, logger });

  const routed = [];

  for (const [supplierId, supplierProducts] of groups) {
    const adapter = adapterById.get(supplierId);
    const supplierName = adapter?.name ?? supplierId;
    const order = { id: orderId, customer, totalCents };
    const itemsForSupplier = supplierProducts.map((product) => ({
      productId: product.id,
      externalId: product.external_id,
      title: product.title,
      qty: product.qty,
      unitPriceCents: product.price_cents,
    }));

    let itemStatus = 'queued';
    let ref = null;
    let failure = null;

    if (adapter) {
      try {
        const result = await adapter.placeOrder({ order, items: itemsForSupplier, customer });
        itemStatus = result.status === 'sent' ? 'sent' : 'queued';
        ref = result.ref ?? null;
      } catch (error) {
        failure = error.message;
        logger.warn('supplier order API unavailable, falling back to email outbox', {
          supplier: supplierId,
          orderId,
          error: error.message,
        });
      }
    }

    if (itemStatus !== 'sent') {
      const { subject, text } = composeSupplierEmail({
        order,
        items: itemsForSupplier,
        customer,
        supplierName,
      });
      const email = config.orders.supplierEmail?.[supplierId] ?? `orders+${supplierId}@marketapp.local`;
      const outboxId = enqueueOutbox(db, {
        orderId,
        supplierId,
        channel: 'email',
        to: email,
        subject,
        body: text,
      });
      ref = ref ?? `outbox:${outboxId}`;
    }

    transaction(db, () => {
      run(db, 'UPDATE order_items SET supplier_order_status = ?, supplier_ref = ?, error = ? WHERE order_id = ? AND supplier_id = ?', {
        1: itemStatus,
        2: ref,
        3: failure ? failure.slice(0, 300) : null,
        4: orderId,
        5: supplierId,
      });
    });

    routed.push({ supplierId, supplierName, status: itemStatus, ref, items: itemsForSupplier.length });
  }

  // "sent" = supplier API accepted it; "queued" = email queued for the supplier.
  // Both are fully automatic, so the order is routed either way.
  const orderStatus = routed.every((entry) => entry.status === 'sent') ? 'routed' : 'routed_email';

  run(db, 'UPDATE orders SET status = ? WHERE id = ?', { 1: orderStatus, 2: orderId });
  logger.info('order created', { orderId, totalCents, suppliers: routed.length, status: orderStatus });

  // Logistics never blocks the order: a missing/failed waybill is recorded, not thrown.
  let ttn = null;
  if (novaPoshta?.configured) {
    try {
      const waybill = await novaPoshta.createWaybill({
        order: { id: orderId },
        customer,
        items: products.map((product) => ({ qty: product.qty })),
        totalCents,
      });
      ttn = waybill?.ttn ?? null;
      run(db, 'UPDATE orders SET ttn = ?, ttn_status = ? WHERE id = ?', [ttn, ttn ? 'created' : 'pending', orderId]);
    } catch (error) {
      run(db, 'UPDATE orders SET ttn_status = ? WHERE id = ?', ['failed', orderId]);
      logger.warn('nova poshta waybill failed', { orderId, error: error.message });
    }
  }

  return {
    orderId,
    status: orderStatus,
    totalCents,
    currency: 'UAH',
    payment: 'cod',
    ttn,
    suppliers: routed,
    items: products.map((product) => ({
      productId: product.id,
      title: product.title,
      qty: product.qty,
      unitPriceCents: product.price_cents,
    })),
  };
}

export function listRecentOrders(db, limit = 20) {
  return all(db, 'SELECT id, status, total_cents, created_at FROM orders ORDER BY created_at DESC LIMIT ?', { 1: limit });
}

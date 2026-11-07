/**
 * SalesDrive order payload for the Dropt integration.
 *
 * Dropt pulls orders from SalesDrive and requires: order type «Дроп»,
 * client name/phone, delivery (Nova Poshta), the **sale price per item**
 * (our retail price, never the drop price) and the payment method.
 *
 * SalesDrive's `/handler/` endpoint accepts the full Nova Poshta block
 * (city/warehouse), which the `/api/order/update/` endpoint explicitly cannot
 * change — so creation goes through `/handler/`.
 */
import { AppError } from '../core/errors.js';

const CYRILLIC_NAME = /^[А-ЯІЇЄҐа-яіїєґ'’\- ]{2,60}$/;

export function splitName(fullName) {
  const parts = String(fullName ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ');
  const [lName = '', fName = '', ...rest] = parts;
  return { lName, fName, mName: rest.join(' ') };
}

/** +380XXXXXXXXX or 0XXXXXXXXX → 380XXXXXXXXX */
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `38${digits}`;
  if (digits.startsWith('380')) return digits.slice(0, 12);
  if (digits.length === 12 && digits.startsWith('38')) return digits;
  return null;
}

export function validateCustomer(customer) {
  const phone = normalizePhone(customer?.phone);
  if (!phone || phone.length !== 12) {
    throw new AppError('Некоректний телефон для SalesDrive', { code: 'salesdrive_bad_phone', status: 422 });
  }
  const { lName, fName } = splitName(customer?.fullName);
  if (!CYRILLIC_NAME.test(lName) || lName.length < 2) {
    throw new AppError('Некоректне прізвище для SalesDrive', { code: 'salesdrive_bad_name', status: 422 });
  }
  if (!fName || fName.length < 2) {
    throw new AppError('Некоректне імʼя для SalesDrive', { code: 'salesdrive_bad_name', status: 422 });
  }
  if (!String(customer?.city ?? '').trim()) {
    throw new AppError('Не вказано місто', { code: 'salesdrive_no_city', status: 422 });
  }
  if (!String(customer?.branch ?? '').trim()) {
    throw new AppError('Не вказано відділення', { code: 'salesdrive_no_branch', status: 422 });
  }
  return { phone, ...splitName(customer.fullName) };
}

/**
 * @param {{order: object, customer: object, items: Array<{productId,title,qty,unitPriceCents}>, options?: object}} input
 */
export function buildSalesDriveOrder({ order, customer, items, options = {} }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Порожнє замовлення', { code: 'salesdrive_empty_order', status: 422 });
  }

  const contact = validateCustomer(customer);

  const products = items.map((item) => {
    // Guard: the sale price must be our retail price (what the customer pays).
    if (!Number.isFinite(item.unitPriceCents) || item.unitPriceCents <= 0) {
      throw new AppError(`Некоректна ціна товару ${item.productId}`, { code: 'salesdrive_bad_price', status: 422 });
    }
    return {
      id: String(item.productId),
      sku: String(item.productId),
      name: String(item.title).slice(0, 250),
      costPerItem: Number((item.unitPriceCents / 100).toFixed(2)),
      amount: Number(item.qty),
    };
  });

  return {
    getResultData: 1,
    externalId: String(order.id),
    lName: contact.lName,
    fName: contact.fName,
    ...(contact.mName ? { mName: contact.mName } : {}),
    phone: contact.phone,
    shipping_method: options.shippingMethod ?? 'novaposhta',
    payment_method: options.paymentMethod ?? 'cod',
    comment: `MarketApp ${order.id}${customer.comment ? ` · ${String(customer.comment).slice(0, 200)}` : ''}`,
    sajt: options.site ?? 'MarketApp',
    products,
    novaposhta: {
      ServiceType: 'Warehouse',
      payer: 'recipient',
      city: String(customer.city).trim(),
      WarehouseNumber: String(customer.branch).trim(),
    },
    ...(options.statusId ? { statusId: options.statusId } : {}),
  };
}

/**
 * Price parsing for supplier feeds.
 * Feeds in the wild use "1 299,00", "1.299,00", "1299.00", "1,299.00" …
 * A naive parseFloat("1 299,00") returns 1 — which would sell a 1 299 ₴ item
 * for 1 ₴. Everything goes through this module.
 */

export const MIN_PRICE_CENTS = 1000; // 10 ₴
export const MAX_PRICE_CENTS = 1_000_000_000; // 10 000 000 ₴

function collapseSingleSeparator(text, separator) {
  const parts = text.split(separator);
  if (parts.length === 1) return text;

  const last = parts[parts.length - 1];
  const isDecimal = parts.length === 2 && last.length > 0 && last.length <= 2;
  if (isDecimal) return `${parts[0]}.${last}`;

  // "1.299" / "1 299" — thousands separator, drop all of them
  return parts.join('');
}

/** @returns {number|null} cents, or null when the value is implausible. */
export function parseFeedPrice(raw) {
  if (raw === null || raw === undefined) return null;

  let cleaned = String(raw).replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the right-most one is the decimal separator.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    cleaned = cleaned.split(thousands).join('');
    const index = cleaned.lastIndexOf(decimal);
    cleaned = `${cleaned.slice(0, index).replace(/[.,]/g, '')}.${cleaned.slice(index + 1)}`;
  } else if (lastComma >= 0) {
    cleaned = collapseSingleSeparator(cleaned, ',');
  } else if (lastDot >= 0) {
    cleaned = collapseSingleSeparator(cleaned, '.');
  }

  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;

  const cents = Math.round(value * 100);
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return null;
  return cents;
}

/** UAH only: a USD feed would otherwise be priced as hryvnia. */
export function isSupportedCurrency(raw) {
  const value = String(raw ?? 'UAH').trim().toUpperCase();
  return value === '' || value === 'UAH' || value === 'ГРН' || value === '₴' || value === '980';
}

/** Resolves supplier image URLs that may be relative. */
export function resolveImageUrl(raw, origin) {
  const src = String(raw ?? '').trim();
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/') && origin) return `${origin.replace(/\/$/, '')}${src}`;
  return null;
}

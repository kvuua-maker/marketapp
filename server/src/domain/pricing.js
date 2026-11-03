/**
 * Price engine. The owner never sets retail prices: retail = wholesale * (1 + margin),
 * then rounded to a "beautiful" psychological price.
 */

/** Rounds an amount in cents so the price ends with 9 in whole hryvnias. */
export function roundToNine(cents) {
  const whole = Math.ceil(cents / 100);
  if (whole < 10) return Math.max(whole, 1) * 100;
  const candidate = Math.ceil((whole - 9) / 10) * 10 + 9;
  const adjusted = candidate < whole ? candidate + 10 : candidate;
  return adjusted * 100;
}

export function roundPlain(cents) {
  return Math.round(cents);
}

/**
 * @param {number} costCents wholesale price in cents
 * @param {number} marginPercent e.g. 15 for +15%
 * @param {{rounding?: 'x9'|'none', minMarginPercent?: number}} [options]
 * @returns {{priceCents: number, marginPercent: number, appliedRounding: string}}
 */
export function retailPrice(costCents, marginPercent, options = {}) {
  const { rounding = 'x9', minMarginPercent = 5 } = options;
  if (!Number.isFinite(costCents) || costCents <= 0) {
    throw new Error(`Invalid costCents: ${costCents}`);
  }
  const margin = Number.isFinite(marginPercent) ? Math.max(marginPercent, minMarginPercent) : minMarginPercent;
  const raw = costCents * (1 + margin / 100);
  const priceCents = rounding === 'none' ? roundPlain(raw) : roundToNine(raw);
  // Never sell below cost, even if margin was configured as zero/negative.
  const safePrice = Math.max(priceCents, Math.ceil(costCents * 1.01));
  return { priceCents: safePrice, marginPercent: margin, appliedRounding: rounding };
}

/** Formats cents as "1 499 ₴" (used by tests and logs). */
export function formatUah(cents) {
  return `${(cents / 100).toLocaleString('uk-UA', { maximumFractionDigits: 0 })} ₴`;
}

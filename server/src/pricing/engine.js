/**
 * Deterministic dynamic-pricing decision.
 *
 * Rules (all configurable):
 *  • floor   = cost × (1 + floorMargin)         — never sell below this
 *  • ceiling = cost × (1 + maxMargin)           — cap when competitors are expensive
 *  • target  = cheapest competitor × (1 − undercut), rounded to x9
 *  • no competitor data        → keep the current price (parser failure guard)
 *  • all competitors < cost    → floor price (dumping guard)
 *  • |target − current| > max  → pause the product, keep the current price
 */
import { roundToNine } from '../domain/pricing.js';

export const DEFAULTS = {
  floorMarginPercent: 15,
  undercutPercent: 2,
  maxMarginPercent: 50,
  maxDailyChangePercent: 30,
};

export function decidePrice({ costCents, currentPriceCents, competitorPrices = [], options = {} }) {
  const {
    floorMarginPercent,
    undercutPercent,
    maxMarginPercent,
    maxDailyChangePercent,
  } = { ...DEFAULTS, ...options };

  if (!Number.isFinite(costCents) || costCents <= 0) {
    return { status: 'invalid', priceCents: currentPriceCents, reason: 'invalid cost' };
  }
  if (!Number.isFinite(currentPriceCents) || currentPriceCents <= 0) {
    return { status: 'invalid', priceCents: currentPriceCents, reason: 'invalid current price' };
  }

  const floorPrice = roundToNine(costCents * (1 + floorMarginPercent / 100));
  // Rounding up must never push the price above the configured max margin:
  // 500 + 50% = 750 → x9 would give 759 (51.8%), so step back to 749.
  const rawCeiling = costCents * (1 + maxMarginPercent / 100);
  let ceilingPrice = roundToNine(rawCeiling);
  if (ceilingPrice > rawCeiling) ceilingPrice = Math.max(floorPrice, ceilingPrice - 1000);
  ceilingPrice = Math.max(floorPrice, ceilingPrice);
  const base = { floorPrice, ceilingPrice, costCents };

  const prices = (competitorPrices ?? []).filter((price) => Number.isFinite(price) && price > 0);

  // Guard #1: parser failure / no offers → do not touch the price.
  if (prices.length === 0) {
    return { ...base, status: 'no_data', priceCents: currentPriceCents, reason: 'no competitor prices' };
  }

  // Guard #2: dumping — ignore competitors below our own cost.
  const valid = prices.filter((price) => price >= costCents);
  if (valid.length === 0) {
    const deltaPct = ((floorPrice - currentPriceCents) / currentPriceCents) * 100;
    if (Math.abs(deltaPct) > maxDailyChangePercent) {
      return {
        ...base,
        status: 'paused',
        priceCents: currentPriceCents,
        reason: `floor move ${deltaPct.toFixed(1)}% exceeds ${maxDailyChangePercent}%`,
      };
    }
    return {
      ...base,
      status: 'floor',
      priceCents: floorPrice,
      reason: `all ${prices.length} competitors below cost (dumping) → floor`,
      cheapestCents: null,
    };
  }

  const cheapest = Math.min(...valid);
  const raw = cheapest * (1 - undercutPercent / 100);
  const target = Math.min(Math.max(roundToNine(raw), floorPrice), ceilingPrice);

  if (target === currentPriceCents) {
    return { ...base, status: 'unchanged', priceCents: target, cheapestCents: cheapest, reason: 'already at target' };
  }

  // Guard #3: a jump bigger than the daily cap means a parser problem — pause.
  const deltaPct = ((target - currentPriceCents) / currentPriceCents) * 100;
  if (Math.abs(deltaPct) > maxDailyChangePercent) {
    return {
      ...base,
      status: 'paused',
      priceCents: currentPriceCents,
      cheapestCents: cheapest,
      reason: `change ${deltaPct.toFixed(1)}% exceeds ${maxDailyChangePercent}%`,
    };
  }

  return {
    ...base,
    status: 'updated',
    priceCents: target,
    cheapestCents: cheapest,
    reason: `cheapest ${(cheapest / 100).toFixed(2)} −${undercutPercent}%`,
  };
}

export function marginPercent(priceCents, costCents) {
  if (!Number.isFinite(costCents) || costCents <= 0) return 0;
  return ((priceCents - costCents) / costCents) * 100;
}

/**
 * Matches a catalogue product to competitor listings.
 * Token overlap is enough for Prom/hotline titles, with a bonus when the
 * supplier's model or vendor appears verbatim in the competitor title.
 */
import { norm } from '../domain/normalize.js';

const STOP = new Set([
  'для', 'the', 'and', 'та', 'і', 'на', 'з', 'для', 'по', 'від', 'до', 'у', 'в',
  'шт', 'см', 'мм', 'вт', 'w', 'v', 'new', 'нов', 'ориг', 'оригінал',
]);

function tokens(value) {
  return new Set(
    norm(value)
      .split(/[^a-zа-яіїєґ0-9]+/i)
      .filter((token) => token.length > 2 && !STOP.has(token)),
  );
}

/**
 * @returns {number} 0..1 similarity
 */
export function matchScore(productTitle, offerTitle, { model = '', vendor = '' } = {}) {
  const a = tokens(productTitle);
  const b = tokens(offerTitle);
  if (a.size === 0 || b.size === 0) return 0;

  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  const jaccard = common / (a.size + b.size - common);

  let bonus = 0;
  const haystack = norm(offerTitle);
  if (model && String(model).length >= 3 && haystack.includes(norm(model))) bonus += 0.25;
  if (vendor && String(vendor).length >= 3 && haystack.includes(norm(vendor))) bonus += 0.1;

  return Math.min(1, jaccard + bonus);
}

/** Picks the cheapest sufficiently similar offer. */
export function pickCheapestMatch(productTitle, offers, { model, vendor, minScore = 0.5 } = {}) {
  let best = null;
  for (const offer of offers ?? []) {
    const score = matchScore(productTitle, offer.title, { model, vendor });
    if (score < minScore) continue;
    if (!best || offer.priceCents < best.priceCents) best = { ...offer, score };
  }
  return best;
}

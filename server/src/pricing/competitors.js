/**
 * Competitor price collection.
 *
 * Prom.ua serves server-rendered search pages with the price in a data
 * attribute, so parsing is cheap and stable:
 *   <a title="…" data-qaid="product_link" href="/ua/p…html">
 *   <div data-qaid="product_price" data-qaprice="497" data-qacurrency="₴/шт.">
 *
 * Hotline.ua currently answers its old search route with
 * "Legacy home controller has been disabled"; the collector degrades to an
 * empty result and the pricing engine then keeps the current price (guard #1).
 */
import { fetchText } from '../core/httpClient.js';
import { decodeEntities } from '../domain/text.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const CARD_RE =
  /title="([^"]+)"[^>]*data-qaid="product_link"[^>]*href="([^"]+)"[\s\S]{0,4000}?data-qaid="product_price"[^>]*data-qaprice="([0-9]+(?:\.[0-9]+)?)"/g;

/** Parses a Prom.ua search page into [{title, url, priceCents}]. */
export function parsePromHtml(html) {
  const offers = [];
  for (const match of String(html ?? '').matchAll(CARD_RE)) {
    const title = decodeEntities(match[1]).trim();
    const href = match[2];
    const price = Number(match[3]);
    if (!title || !Number.isFinite(price) || price <= 0) continue;
    offers.push({
      title,
      url: href.startsWith('http') ? href : `https://prom.ua${href}`,
      priceCents: Math.round(price * 100),
    });
  }
  return offers;
}

export async function searchProm(query, { timeoutMs = 20_000 } = {}) {
  const url = `https://prom.ua/ua/search?search_term=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    timeoutMs,
    retries: 1,
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    label: 'prom.ua',
  });
  return parsePromHtml(html);
}

export async function searchHotline(query, { timeoutMs = 20_000 } = {}) {
  const url = `https://hotline.ua/ua/search/?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchText(url, {
      timeoutMs,
      retries: 0,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      label: 'hotline.ua',
    });
    // The legacy controller answers with a 40-byte stub — treat it as no data.
    if (!html || html.length < 500 || /Legacy home controller/i.test(html)) return [];
    const offers = [];
    const priceRe = /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,400}?"title"\s*:\s*"([^"]{5,200})"/g;
    for (const match of html.matchAll(priceRe)) {
      const price = Number(match[1]);
      if (!Number.isFinite(price) || price <= 0) continue;
      offers.push({ title: decodeEntities(match[2]), url, priceCents: Math.round(price * 100) });
    }
    return offers;
  } catch {
    return [];
  }
}

export const SOURCES = {
  prom: searchProm,
  hotline: searchHotline,
};

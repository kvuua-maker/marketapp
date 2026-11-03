const STOPWORDS = new Set([
  'usb', 'led', 'wifi', 'mini', 'pro', 'max', 'plus', 'smart', 'type', 'hd', '4k', 'rgb', 'tws',
  'bluetooth', 'set', 'new', 'original', 'for', 'and', 'the', 'with', 'sport', 'home', 'cable',
  'power', 'bank', 'black', 'white', 'blue', 'green', 'red', 'pink', 'sort', 'pcs', 'шт', 'см',
]);

/**
 * The supplier returns an empty `brands` array for the whole catalog.
 * Derive a usable brand from the product name (first capitalised Latin token),
 * so brand search/filter is not permanently empty.
 */
export function guessBrand(title) {
  const tokens = String(title ?? '').match(/[A-Za-z][A-Za-z0-9&.+-]*/g) ?? [];
  for (const raw of tokens) {
    const token = raw.replace(/[.,+\-]+$/, '');
    const lower = token.toLowerCase();
    if (token.length < 2) continue;
    if (STOPWORDS.has(lower)) continue;
    if (!/^[A-Z]/.test(token)) continue;
    if (/^\d/.test(token)) continue;
    return token;
  }
  return '';
}

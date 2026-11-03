const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripHtml(value) {
  const withoutTags = String(value ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutTags)
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function truncate(value, maxChars, { ellipsis = '…' } = {}) {
  const text = collapseWhitespace(value);
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[,;:.\-–—]$/, '')}${ellipsis}`;
}

/** First meaningful sentences, capped — used as a storefront subtitle. */
export function firstSentences(value, maxChars = 180) {
  const text = collapseWhitespace(value);
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let result = '';
  for (const sentence of sentences) {
    if ((result + ' ' + sentence).trim().length > maxChars) break;
    result = `${result} ${sentence}`.trim();
  }
  if (!result) result = truncate(text, maxChars);
  return result;
}

/**
 * Very small language heuristic for Ukrainian vs Russian.
 * Feeds are mixed, and the storefront must be Ukrainian.
 */
export function detectLanguage(value) {
  const text = String(value ?? '').toLowerCase();
  const uk = (text.match(/[іїєґ]/g) ?? []).length;
  const ru = (text.match(/[ыэъё]/g) ?? []).length;
  if (uk === 0 && ru === 0) return 'unknown';
  return uk >= ru ? 'uk' : 'ru';
}

export function normalizeTitle(value, maxChars = 120) {
  const base = collapseWhitespace(decodeEntities(value))
    .replace(/\s*[|/]+\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ');
  const trimmed = truncate(base, maxChars, { ellipsis: '' });
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Stable hash of the fields that influence AI output — used to skip re-processing. */
export function contentHash(parts) {
  const payload = JSON.stringify(parts);
  // Small FNV-1a (64-bit-ish via two 32-bit lanes) is enough for cache keys.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < payload.length; i += 1) {
    const code = payload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

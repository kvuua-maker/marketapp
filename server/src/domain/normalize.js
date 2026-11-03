/**
 * Text normalisation for search.
 * SQLite's lower() only folds ASCII, so Cyrillic search was case-sensitive.
 * We store pre-normalised columns and normalise the query in JS (Unicode-aware).
 */
export function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[’ʼ`´]/g, "'")
    .replace(/[«»“”„]/g, '"')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ukrainian phone -> +380XXXXXXXXX (or null). */
export function normPhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  const match = digits.match(/^(?:\+?38)?0(\d{9})$/);
  return match ? `+380${match[1]}` : null;
}

/** Strips punctuation so "навушники," matches "навушники". */
export function searchToken(value) {
  return norm(value).replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

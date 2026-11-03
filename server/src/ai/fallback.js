import { classifyCategory } from '../domain/categories.js';
import { firstSentences, normalizeTitle, detectLanguage } from '../domain/text.js';

/**
 * Deterministic fallback used when DEEPSEEK_API_KEY is absent or the model fails.
 * It keeps the pipeline (and the storefront) alive, but it does NOT translate:
 * titles stay in the supplier's language and are flagged with ai_status = "fallback".
 */
export function fallbackEnrich(raw) {
  const language = detectLanguage(raw.title);
  return {
    title: normalizeTitle(raw.title, 90),
    shortDescription: firstSentences(raw.description, 160),
    category: classifyCategory({
      categoryRaw: raw.categoryRaw,
      title: raw.title,
      description: raw.description,
    }),
    language,
    source: 'fallback',
  };
}

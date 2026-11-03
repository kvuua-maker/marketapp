const RULES = [
  { test: (text) => text.length < 8, reason: 'too_short' },
  { test: (text) => /https?:\/\/|www\./i.test(text), reason: 'contains_links' },
  { test: (text) => /(.)\1{6,}/.test(text), reason: 'spam_repetition' },
  { test: (text) => (text.match(/!/g) ?? []).length > 5, reason: 'spam_punctuation' },
];

/**
 * Review moderation. Deterministic rules first (free), DeepSeek only for the
 * grey zone. Returns { status: 'published' | 'rejected', reason }.
 */
export async function moderateReview({ client, author, rating, text, logger }) {
  const clean = String(text ?? '').trim();
  const name = String(author ?? '').trim();

  if (name.length < 2) return { status: 'rejected', reason: 'author_missing' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { status: 'rejected', reason: 'rating_out_of_range' };
  }
  for (const rule of RULES) {
    if (rule.test(clean)) return { status: 'rejected', reason: rule.reason };
  }

  if (!client?.enabled) return { status: 'published', reason: 'rules_passed' };

  try {
    const verdict = await client.completeJSON({
      system: `Ти модеруєш відгуки в магазині електроніки. Поверни JSON:
{"publish": true|false, "reason": "коротко"}
Відхиляй: рекламу, образи, персональні дані, нецензурну лексику, текст не про товар.`,
      user: JSON.stringify({ product_rating: rating, review_text: clean.slice(0, 500) }),
      maxTokens: 120,
      temperature: 0,
    });
    const publish = verdict?.publish !== false;
    return { status: publish ? 'published' : 'rejected', reason: String(verdict?.reason ?? '').slice(0, 120) };
  } catch (error) {
    logger?.warn('review moderation fell back to rules', { error: error.message });
    return { status: 'published', reason: 'rules_passed_model_unavailable' };
  }
}

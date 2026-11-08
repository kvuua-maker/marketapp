/** Free social content generation: product pick + AI text + templates. */
const uah = (c) => `${(c / 100).toFixed(0)} ₴`;

export function pickProducts(db, { mode = 'popular', limit = 5 } = {}) {
  const order = mode === 'cheap' ? 'p.price_cents ASC' : 'views DESC, p.price_cents DESC';
  return db.prepare(`
    SELECT p.id, p.title, p.price_cents, p.old_price_cents, p.image_url, p.category,
           (SELECT COUNT(*) FROM events e WHERE e.product_id = p.id AND e.created_at >= datetime('now','-30 days')) AS views
      FROM products p
     WHERE p.stock > 0 AND p.hidden_by_price = 0
     ORDER BY ${order} LIMIT ?`).all(limit);
}

export const TEMPLATES = {
  review: (items) => [
    '🔥 ТОП-5 знахідок MarketApp цього тижня',
    '',
    ...items.map((p, i) => `${i + 1}. ${p.title}\n   💰 ${uah(p.price_cents)}`),
    '',
    'Замовляйте в застосунку MarketApp — доставка Новою Поштою, оплата при отриманні.',
    '#MarketApp #електроніка #товариДляДому #Україна',
  ].join('\n'),
  deal: (items) => [
    '💥 ЗНИЖКА ДНЯ',
    '',
    ...items.slice(0, 3).map((p) => `✅ ${p.title}\n   ${uah(p.price_cents)}${p.old_price_cents ? ` (було ${uah(p.old_price_cents)})` : ''}`),
    '',
    'Кількість обмежена. Замовляйте в MarketApp!',
    '#знижка #MarketApp #вигіднаПокупка',
  ].join('\n'),
  compare: (items) => [
    '⚖️ ПОРІВНЯННЯ ЦІН: що вигідніше?',
    '',
    ...items.slice(0, 3).map((p) => `• ${p.title} — ${uah(p.price_cents)}`),
    '',
    'Ми тримаємо ціни нижче ринку. Перевірте самі в MarketApp.',
    '#порівнянняЦін #MarketApp #економія',
  ].join('\n'),
};

export function templatePost(type, items) {
  return (TEMPLATES[type] ?? TEMPLATES.review)(items);
}

export async function aiPost({ config, logger, type, items, template }) {
  const key = config.ai?.apiKey;
  if (!key) return { text: template, ai: false };
  const prompt = `Ти SMM-редактор українського магазину MarketApp. Тип посту: ${type}.
Товари: ${items.map((p) => `${p.title} — ${uah(p.price_cents)}`).join('; ')}.
Напиши короткий пост українською (до 700 символів), з емодзі та 4-6 хештегами.
Без вигаданих характеристик, без брехні про знижки. Поверни лише текст посту.`;
  try {
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.ai.model, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 500 }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty AI answer');
    return { text, ai: true };
  } catch (error) {
    logger?.warn('AI post failed, using template', { error: error.message });
    return { text: template, ai: false };
  }
}

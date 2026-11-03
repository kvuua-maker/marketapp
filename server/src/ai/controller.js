import { CANONICAL_CATEGORIES, coerceCategory } from '../domain/categories.js';
import { fallbackEnrich } from './fallback.js';
import { contentHash, firstSentences, normalizeTitle } from '../domain/text.js';
import { guessBrand } from '../domain/brand.js';
import { retailPrice } from '../domain/pricing.js';
import { all, run } from '../db/database.js';

const SYSTEM_PROMPT = `Ти — AI-контролер товарного каталогу українського маркетплейсу електроніки.
Твоє завдання: підготувати картку товару для вітрини.

ПРАВИЛА:
1. Назва — українською, до 90 символів, без "купити", "акція", "!!!", без повторів бренду.
2. Короткий опис — українською, 1-2 речення, до 200 символів, лише факти з наданого опису.
3. Категорія — рівно одна з наданого списку, без вигадування нових.
4. Не вигадуй характеристики, яких немає у вхідних даних.
5. Відповідай ВИКЛЮЧНО валідним JSON без markdown.

Формат відповіді:
{"items":[{"index":0,"title_uk":"...","short_description_uk":"...","category":"..."}]}`;

const STRICT_NOTE = `
УВАГА: у попередній відповіді назва залишилася російською.
Переклади її ПОВНІСТЮ українською, зберігши бренд, модель і цифри латиницею.
Не залишай жодного російського слова (ы, э, ъ, ё, "для", "с", "и" тощо).`;

const RUSSIAN_MARKERS = /[ыэъё]/i;

function buildUserPrompt(items) {
  const compact = items.map((item, index) => ({
    index,
    title: String(item.title ?? '').slice(0, 200),
    category_hint: item.categoryRaw ?? '',
    description: String(item.description ?? '').slice(0, 900),
  }));
  return JSON.stringify({
    categories: CANONICAL_CATEGORIES,
    items: compact,
  });
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

/** Runs async workers over a list with a bounded pool (keeps DeepSeek happy). */
async function mapPool(items, limit, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export class AIController {
  constructor({ client, config, logger, db }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
    this.db = db;
  }

  get enabled() {
    return Boolean(this.client?.enabled);
  }

  get minDescriptionChars() {
    return this.config.ai.minDescriptionChars;
  }

  /** Hard gate: no photo or no meaningful description => product is rejected. */
  validate(raw) {
    if (!raw?.title) return { ok: false, reason: 'missing_title' };
    if (!raw.imageUrl || !String(raw.imageUrl).startsWith('http')) {
      return { ok: false, reason: 'missing_image' };
    }
    const description = String(raw.description ?? '').trim();
    if (description.length < this.minDescriptionChars) {
      return { ok: false, reason: `description_too_short:${description.length}` };
    }
    if (!Number.isFinite(raw.costCents) || raw.costCents <= 0) {
      return { ok: false, reason: 'invalid_price' };
    }
    return { ok: true };
  }

  cacheKey(raw) {
    return contentHash([raw.title, raw.description, raw.categoryRaw ?? '']);
  }

  readCache(hashes) {
    if (hashes.length === 0) return new Map();
    const placeholders = hashes.map((_, index) => `:h${index}`).join(',');
    const params = Object.fromEntries(hashes.map((hash, index) => [`:h${index}`, hash]));
    const rows = all(this.db, `SELECT content_hash, result_json FROM ai_cache WHERE content_hash IN (${placeholders})`, params);
    return new Map(rows.map((row) => [row.content_hash, JSON.parse(row.result_json)]));
  }

  writeCache(entries) {
    for (const [hash, result] of entries) {
      run(
        this.db,
        'INSERT INTO ai_cache(content_hash, result_json, created_at) VALUES(?, ?, ?) ON CONFLICT(content_hash) DO UPDATE SET result_json = excluded.result_json',
        { 1: hash, 2: JSON.stringify(result), 3: new Date().toISOString() },
      );
    }
  }

  async requestModel(batch, { strict = false } = {}) {
    const response = await this.client.completeJSON({
      system: strict ? `${SYSTEM_PROMPT}\n${STRICT_NOTE}` : SYSTEM_PROMPT,
      user: buildUserPrompt(batch),
      maxTokens: Math.min(4000, 300 * batch.length + 400),
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    const byIndex = new Map();
    for (const item of items) {
      const index = Number(item?.index);
      if (Number.isFinite(index)) byIndex.set(index, item);
    }
    return byIndex;
  }

  /** Enriches one validated product into a storefront record (no DB writes). */
  buildRecord(raw, ai, marginPercent) {
    const oldPriceCents =
      Number.isFinite(raw.oldPriceCents) && raw.oldPriceCents > raw.costCents
        ? retailPrice(raw.oldPriceCents, marginPercent, {
            rounding: this.config.pricing.rounding,
            minMarginPercent: this.config.pricing.minMarginPercent,
          }).priceCents
        : null;

    const pricing = retailPrice(raw.costCents, marginPercent, {
      rounding: this.config.pricing.rounding,
      minMarginPercent: this.config.pricing.minMarginPercent,
    });
    return {
      id: `${raw.supplierId}:${raw.externalId}`,
      supplierId: raw.supplierId,
      externalId: raw.externalId,
      title: ai.title,
      description: raw.description,
      shortDescription: ai.shortDescription,
      imageUrl: raw.imageUrl,
      images: raw.images ?? [raw.imageUrl],
      category: ai.category,
      categoryRaw: raw.categoryRaw ?? '',
      costCents: raw.costCents,
      priceCents: pricing.priceCents,
      oldPriceCents,
      marginPercent: pricing.marginPercent,
      currency: raw.currency ?? 'UAH',
      stock: raw.stock ?? 0,
      productUrl: raw.productUrl ?? '',
      vendor: raw.vendor || guessBrand(raw.title),
      aiStatus: ai.source === 'deepseek' ? 'published' : 'fallback',
      aiMeta: { source: ai.source, language: ai.language ?? 'unknown' },
    };
  }

  normalizeAiResult(result, raw) {
    const title = normalizeTitle(result?.title_uk || result?.title || raw.title, 110);
    const shortDescription = firstSentences(
      result?.short_description_uk || result?.shortDescription || result?.description_uk || raw.description,
      200,
    );
    const category = coerceCategory(result?.category, {
      categoryRaw: raw.categoryRaw,
      title: raw.title,
      description: raw.description,
    });
    return {
      title,
      shortDescription,
      category,
      language: 'uk',
      source: result ? 'deepseek' : 'fallback',
    };
  }

  /**
   * Enriches a batch of raw products.
   * @returns {Promise<Array<{raw: object, ok: boolean, reason?: string, record?: object, cached?: boolean}>>}
   */
  async enrichBatch(raws, { marginPercent }) {
    const results = new Map();
    const valid = [];

    for (const raw of raws) {
      const validation = this.validate(raw);
      if (!validation.ok) {
        results.set(raw, { raw, ok: false, reason: validation.reason });
      } else {
        valid.push(raw);
      }
    }

    const hashes = new Map(valid.map((raw) => [raw, this.cacheKey(raw)]));
    const cached = this.readCache([...new Set(hashes.values())]);
    const pending = [];

    for (const raw of valid) {
      const key = hashes.get(raw);
      const hit = cached.get(key);
      if (hit) {
        results.set(raw, {
          raw,
          ok: true,
          cached: true,
          record: this.buildRecord(raw, this.normalizeAiResult(hit, raw), marginPercent),
        });
      } else {
        pending.push(raw);
      }
    }

    if (pending.length === 0) return [...results.values()];

    const batches = chunk(pending, this.config.ai.batchSize);
    const concurrency = this.config.ai.concurrency ?? 1;

    await mapPool(batches, concurrency, async (batch) => {
      let byIndex = null;
      if (this.enabled) {
        try {
          byIndex = await this.requestModel(batch);
        } catch (error) {
          this.logger.warn('DeepSeek batch failed, using fallback', { error: error.message, size: batch.length });
        }
      }

      const cacheWrites = new Map();
      batch.forEach((raw, index) => {
        const aiResult = byIndex?.get(index);
        const ai = aiResult
          ? this.normalizeAiResult(aiResult, raw)
          : { ...fallbackEnrich(raw) };
        if (aiResult) cacheWrites.set(hashes.get(raw), ai);
        results.set(raw, {
          raw,
          ok: true,
          cached: false,
          record: this.buildRecord(raw, ai, marginPercent),
        });
      });
      this.writeCache(cacheWrites);
    });

    await this.repairUntranslated(results, { marginPercent });
    return [...results.values()];
  }

  /**
   * Second pass for titles the model returned in Russian.
   * Cheap (a handful of items) and keeps the storefront fully Ukrainian.
   */
  async repairUntranslated(results, { marginPercent }) {
    if (!this.enabled) return;

    const flagged = [...results.values()].filter(
      (entry) => entry.ok && entry.record && RUSSIAN_MARKERS.test(entry.record.title),
    );
    if (flagged.length === 0) return;

    this.logger.info('retrying untranslated titles', { count: flagged.length });

    for (const batch of chunk(flagged, Math.min(this.config.ai.batchSize, 6))) {
      let byIndex = null;
      try {
        byIndex = await this.requestModel(batch.map((entry) => entry.raw), { strict: true });
      } catch (error) {
        this.logger.warn('strict translation retry failed', { error: error.message });
        return;
      }
      if (!byIndex) continue;

      const cacheWrites = new Map();
      batch.forEach((entry, index) => {
        const aiResult = byIndex.get(index);
        if (!aiResult) return;
        const ai = this.normalizeAiResult(aiResult, entry.raw);
        if (RUSSIAN_MARKERS.test(ai.title)) return;
        entry.record = this.buildRecord(entry.raw, ai, marginPercent);
        cacheWrites.set(this.cacheKey(entry.raw), ai);
      });
      this.writeCache(cacheWrites);
    }
  }
}

import { SupplierAdapter } from './adapter.js';
import { fetchJson } from '../core/httpClient.js';
import { stripHtml, collapseWhitespace, decodeEntities } from '../domain/text.js';

/**
 * Aveopt (Odesa wholesale dropshipping platform).
 * Uses the public WooCommerce Store API — verified live, ~6400 SKU, no auth.
 * Orders cannot be placed through the public API, so the order router falls back
 * to the email outbox for this supplier.
 */
export class AveoptAdapter extends SupplierAdapter {
  constructor(options) {
    super({ ...options, id: 'aveopt', name: 'Aveopt' });
  }

  buildUrl(page, pageSize) {
    const base = String(this.config.baseUrl).replace(/\/$/, '');
    const endpoint = this.config.endpoint ?? '/wp-json/wc/store/v1/products';
    return `${base}${endpoint}?per_page=${pageSize}&page=${page}&orderby=id&order=asc`;
  }

  mapProduct(item) {
    const priceRaw = Number(item?.prices?.price);
    const minorUnit = Number(item?.prices?.currency_minor_unit ?? 0);
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) return null;

    const costCents = Math.round((priceRaw / 10 ** minorUnit) * 100);
    if (!Number.isFinite(costCents) || costCents <= 0) return null;

    const regularRaw = Number(item?.prices?.regular_price);
    const oldPriceCents = Number.isFinite(regularRaw) && regularRaw > priceRaw
      ? Math.round((regularRaw / 10 ** minorUnit) * 100)
      : null;

    const images = (item.images ?? [])
      .map((image) => image?.src)
      .filter((src) => typeof src === 'string' && src.startsWith('http'));
    if (images.length === 0) return null;

    const description = stripHtml(item.description || item.short_description || '');
    const title = collapseWhitespace(decodeEntities(item.name ?? ''));
    if (!title) return null;

    const stock = item.is_in_stock ? (item.low_stock_remaining ?? 1) : 0;

    return {
      externalId: String(item.id),
      title,
      description,
      imageUrl: images[0],
      images,
      costCents,
      oldPriceCents,
      currency: item.prices?.currency_code ?? 'UAH',
      stock,
      categoryRaw: item.categories?.[0]?.name ?? '',
      categoryPath: (item.categories ?? []).map((category) => category.name),
      productUrl: item.permalink ?? '',
      vendor: item.brands?.[0]?.name ?? '',
      attributes: (item.attributes ?? []).map((attribute) => ({
        name: attribute.name,
        value: (attribute.terms ?? []).map((term) => term.name).join(', '),
      })),
      supplierId: this.id,
    };
  }

  async healthCheck() {
    try {
      const items = await fetchJson(this.buildUrl(1, 1), { timeoutMs: 20_000, retries: 1 });
      return Array.isArray(items) && items.length > 0;
    } catch (error) {
      this.logger.warn('health check failed', { error: error.message });
      return false;
    }
  }

  async *fetchProducts({ maxProducts = 8000, pageSize = 100 } = {}) {
    let page = 1;
    let yielded = 0;

    while (yielded < maxProducts) {
      const url = this.buildUrl(page, pageSize);
      const startedAt = Date.now();
      const items = await fetchJson(url, { timeoutMs: 45_000 });
      if (!Array.isArray(items) || items.length === 0) break;

      this.logger.info('page fetched', { page, count: items.length, ms: Date.now() - startedAt });

      for (const item of items) {
        const mapped = this.mapProduct(item);
        if (!mapped) continue;
        yield mapped;
        yielded += 1;
        if (yielded >= maxProducts) return;
      }

      if (items.length < pageSize) break;
      page += 1;
    }
  }

  async placeOrder() {
    const error = new Error('Aveopt public API does not accept orders; using email fallback');
    error.code = 'order_api_unsupported';
    throw error;
  }
}

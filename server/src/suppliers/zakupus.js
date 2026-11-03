import { readFile } from 'node:fs/promises';
import { SupplierAdapter } from './adapter.js';
import { fetchText } from '../core/httpClient.js';
import { extractBlocks, childText, childTexts, cleanFeedText } from './xml.js';
import { collapseWhitespace } from '../domain/text.js';
import { parseFeedPrice, isSupportedCurrency, resolveImageUrl } from '../domain/priceParser.js';

/**
 * Zakupus — B2B electronics supplier publishing an XML price list that already
 * contains wholesale price, partner retail price and stock.
 * Feed may be remote (ZAKUPUS_XML_URL) or local (ZAKUPUS_XML_PATH, used in CI/tests).
 */
export class ZakupusAdapter extends SupplierAdapter {
  constructor(options) {
    super({ ...options, id: 'zakupus', name: 'Zakupus' });
  }

  get isConfigured() {
    return Boolean(this.config.xmlUrl || this.config.xmlPath);
  }

  /** Base origin used to resolve relative image paths. */
  feedOrigin() {
    try {
      return new URL(this.config.xmlUrl).origin;
    } catch {
      return 'https://zakupus.com.ua';
    }
  }

  async loadXml() {
    if (this.config.xmlPath) return readFile(this.config.xmlPath, 'utf8');
    if (this.config.xmlUrl) return fetchText(this.config.xmlUrl, { timeoutMs: 90_000, retries: 2 });
    const error = new Error('Zakupus: ZAKUPUS_XML_URL or ZAKUPUS_XML_PATH is required');
    error.code = 'not_configured';
    throw error;
  }

  /** id -> category name, for feeds that use <categoryId> references. */
  buildCategoryMap(xml) {
    const map = new Map();
    for (const block of extractBlocks(xml, ['category'])) {
      const id = block.attributes.id;
      if (!id) continue;
      map.set(String(id), collapseWhitespace(block.text ?? ''));
    }
    return map;
  }

  mapBlock(block, categoryMap = new Map()) {
    const priceText = childText(block, 'price') || childText(block, 'wholesale_price');
    const costCents = parseFeedPrice(priceText);
    if (!costCents) {
      this.logger?.warn('feed price rejected', { raw: String(priceText).slice(0, 24) });
      return null;
    }

    const currency = childText(block, 'currencyId') || 'UAH';
    if (!isSupportedCurrency(currency)) {
      this.logger?.warn('unsupported currency, product skipped', { currency });
      return null;
    }

    const origin = this.feedOrigin();
    const images = [
      ...childTexts(block, 'picture'),
      ...childTexts(block, 'image'),
    ]
      .map((src) => resolveImageUrl(src, origin))
      .filter(Boolean);
    if (images.length === 0) return null;

    const title = collapseWhitespace(childText(block, 'name') || childText(block, 'title'));
    if (!title) return null;

    const stockText = childText(block, 'quantity_in_stock') || childText(block, 'stock') || childText(block, 'quantity');
    const stock = Number.parseInt(stockText || '0', 10);

    const params = (block.children.param ?? []).map((entry) => ({
      name: entry.attributes.name ?? '',
      value: entry.text.trim(),
    }));

    const categoryId = childText(block, 'categoryId');
    const categoryRaw = childText(block, 'category') || categoryMap.get(categoryId) || '';

    return {
      externalId: String(block.attributes.id ?? childText(block, 'id') ?? title),
      title,
      description: cleanFeedText(childText(block, 'description')),
      imageUrl: images[0],
      images,
      costCents,
      oldPriceCents: parseFeedPrice(childText(block, 'oldprice') || childText(block, 'old_price')),
      currency: 'UAH',
      stock: Number.isFinite(stock) ? stock : 0,
      categoryRaw,
      categoryPath: [],
      productUrl: childText(block, 'url'),
      vendor: childText(block, 'vendor'),
      attributes: params,
      supplierId: this.id,
    };
  }

  async healthCheck() {
    if (!this.isConfigured) return false;
    try {
      const xml = await this.loadXml();
      return extractBlocks(xml).length > 0;
    } catch (error) {
      this.logger.warn('health check failed', { error: error.message });
      return false;
    }
  }

  async *fetchProducts({ maxProducts = 8000 } = {}) {
    const xml = await this.loadXml();
    const categoryMap = this.buildCategoryMap(xml);
    const blocks = extractBlocks(xml);
    this.logger.info('feed parsed', { blocks: blocks.length, categories: categoryMap.size });

    let yielded = 0;
    for (const block of blocks) {
      const mapped = this.mapBlock(block, categoryMap);
      if (!mapped) continue;
      yield mapped;
      yielded += 1;
      if (yielded >= maxProducts) return;
    }
  }

  async placeOrder() {
    const error = new Error('Zakupus has no public order API; using email fallback');
    error.code = 'order_api_unsupported';
    throw error;
  }
}

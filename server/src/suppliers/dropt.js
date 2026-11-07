import { readFile } from 'node:fs/promises';
import { ZakupusAdapter } from './zakupus.js';
import { fetchText } from '../core/httpClient.js';

/**
 * Dropt — second supplier, Prom/YML export.
 *
 * Feed: https://dropt.in.ua/index.php?route=export/prom&markup=0&ids=uniq
 * Parsing is shared with the Zakupus/Aveopt XML adapters (price safety,
 * currency whitelist, image resolving, category map).
 *
 * Product ids are prefixed (`dropt_12345`) so they can never collide with
 * Aveopt (`aveopt:…`) even if the numeric ids overlap. The database row still
 * keeps supplier_id='dropt' + external_id='12345', so updates stay idempotent.
 */
export class DroptAdapter extends ZakupusAdapter {
  constructor(options) {
    super(options);
    this.id = 'dropt';
    this.name = 'Dropt';
    this.maxProducts = options?.config?.maxProducts ?? null;
  }

  get isConfigured() {
    return Boolean(this.config.xmlUrl || this.config.xmlPath);
  }

  feedOrigin() {
    try {
      return new URL(this.config.xmlUrl).origin;
    } catch {
      return 'https://dropt.in.ua';
    }
  }

  /**
   * Canary against double pricing: the feed must be requested with markup=0.
   * Any supplier-side markup would be multiplied by our own margin.
   */
  assertNoSupplierMarkup() {
    const url = this.config.xmlUrl;
    if (!url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    const markup = parsed.searchParams.get('markup');
    if (markup !== null && Number(markup) !== 0) {
      const error = new Error(
        `Dropt feed requested with markup=${markup}; expected markup=0 (our server applies the single margin)`,
      );
      error.code = 'feed_markup_detected';
      throw error;
    }
  }

  /** The shop name changes to "Dropt (Наценка N%)" when the feed carries a markup. */
  assertFeedName(xml) {
    const match = xml.match(/<name>\s*([^<]*?)\s*<\/name>/i);
    const shopName = match?.[1] ?? '';
    if (/наценк/i.test(shopName)) {
      const error = new Error(`Dropt feed carries a supplier markup (shop name: "${shopName}"); refusing to sync`);
      error.code = 'feed_markup_detected';
      throw error;
    }
  }

  async loadXml() {
    this.assertNoSupplierMarkup();

    let xml;
    if (this.config.xmlPath) xml = await readFile(this.config.xmlPath, 'utf8');
    else if (this.config.xmlUrl) xml = await fetchText(this.config.xmlUrl, { timeoutMs: 240_000, retries: 2 });
    else {
      const error = new Error('Dropt: DROPT_XML_URL or DROPT_XML_PATH is required');
      error.code = 'not_configured';
      throw error;
    }

    this.assertFeedName(xml);
    return xml;
  }

  async healthCheck() {
    try {
      this.assertNoSupplierMarkup();
      return await super.healthCheck();
    } catch (error) {
      this.logger?.error('dropt feed blocked', { error: error.message, code: error.code });
      return false;
    }
  }

  mapBlock(block, categoryMap = new Map()) {
    const mapped = super.mapBlock(block, categoryMap);
    if (!mapped) return null;
    mapped.idPrefix = this.config.idPrefix ?? 'dropt_';
    return mapped;
  }
}

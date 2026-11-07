import { readFile } from 'node:fs/promises';
import { ZakupusAdapter } from './zakupus.js';
import { fetchText } from '../core/httpClient.js';

/**
 * LUGI XML feed (UniXML/Prom export on feed.lugi.com.ua).
 *
 * The supplier has no public API yet, so the catalogue comes from the feed:
 *   https://feed.lugi.com.ua/index.php?route=extension/feed/unixml/prom
 * Prices are LUGI's wholesale (opt) prices in UAH; our margin is applied by
 * the pricing engine, never by the supplier.
 *
 * Product ids are prefixed (lugi_123) to avoid collisions with other feeds.
 */
export class LugiXmlAdapter extends ZakupusAdapter {
  constructor(options) {
    super(options);
    this.id = 'lugi';
    this.name = 'LUGI (XML)';
  }

  get isConfigured() {
    return Boolean(this.config.xmlUrl || this.config.xmlPath);
  }

  feedOrigin() {
    try {
      return new URL(this.config.xmlUrl).origin;
    } catch {
      return 'https://feed.lugi.com.ua';
    }
  }

  async loadXml() {
    if (this.config.xmlPath) return readFile(this.config.xmlPath, 'utf8');
    if (this.config.xmlUrl) return fetchText(this.config.xmlUrl, { timeoutMs: 180_000, retries: 2 });
    const error = new Error('LUGI: LUGI_XML_URL or LUGI_XML_PATH is required');
    error.code = 'not_configured';
    throw error;
  }

  mapBlock(block, categoryMap = new Map()) {
    const mapped = super.mapBlock(block, categoryMap);
    if (!mapped) return null;
    mapped.idPrefix = this.config.idPrefix ?? 'lugi_';
    return mapped;
  }

  async placeOrder() {
    const error = new Error('LUGI has no order API; using the email outbox');
    error.code = 'order_api_unsupported';
    throw error;
  }
}

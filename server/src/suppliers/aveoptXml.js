import { readFile } from 'node:fs/promises';
import { ZakupusAdapter } from './zakupus.js';
import { fetchText } from '../core/httpClient.js';

/**
 * Aveopt XML/YML price list.
 *
 * Aveopt's primary integration is the public WooCommerce Store API
 * (AVEPTO_SOURCE=api). Some accounts also receive a YML/XML export at a
 * permanent URL; this adapter consumes it without changing the rest of the
 * pipeline (margin, AI enrichment, FTS, dedupe, order routing).
 *
 * Enabled with AVEPTO_SOURCE=xml + AVEPTO_XML_URL (or AVEPTO_XML_PATH for tests).
 * Parsing is shared with the Zakupus XML adapter.
 */
export class AveoptXmlAdapter extends ZakupusAdapter {
  constructor(options) {
    super(options);
    this.id = 'aveopt';
    this.name = 'Aveopt (XML)';
  }

  get isConfigured() {
    return Boolean(this.config.xmlUrl || this.config.xmlPath);
  }

  feedOrigin() {
    try {
      return new URL(this.config.xmlUrl).origin;
    } catch {
      return 'https://www.aveopt.com.ua';
    }
  }

  async loadXml() {
    if (this.config.xmlPath) return readFile(this.config.xmlPath, 'utf8');
    if (this.config.xmlUrl) return fetchText(this.config.xmlUrl, { timeoutMs: 120_000, retries: 2 });
    const error = new Error('Aveopt: AVEPTO_XML_URL or AVEPTO_XML_PATH is required');
    error.code = 'not_configured';
    throw error;
  }
}

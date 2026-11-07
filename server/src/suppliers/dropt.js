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

  async loadXml() {
    if (this.config.xmlPath) return readFile(this.config.xmlPath, 'utf8');
    if (this.config.xmlUrl) return fetchText(this.config.xmlUrl, { timeoutMs: 240_000, retries: 2 });
    const error = new Error('Dropt: DROPT_XML_URL or DROPT_XML_PATH is required');
    error.code = 'not_configured';
    throw error;
  }

  mapBlock(block, categoryMap = new Map()) {
    const mapped = super.mapBlock(block, categoryMap);
    if (!mapped) return null;
    mapped.idPrefix = this.config.idPrefix ?? 'dropt_';
    return mapped;
  }
}

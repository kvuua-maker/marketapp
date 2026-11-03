import { SupplierAdapter, requireConfig } from './adapter.js';
import { fetchJson } from '../core/httpClient.js';
import { stripHtml, collapseWhitespace } from '../domain/text.js';

/**
 * LUGI — Ukrainian wholesale/dropshipping supplier of electronics and appliances.
 * API contract follows the public examples published by LUGI (lugiopt-ai):
 *   POST /api/v1/auth/token {company_id, company_secret} -> {access_token}
 *   GET  /api/v1/me
 *   GET  /api/v1/products?limit=100&cursor=...
 * The real host and credentials are issued during partner onboarding.
 */
export class LugiAdapter extends SupplierAdapter {
  constructor(options) {
    super({ ...options, id: 'lugi', name: 'LUGI' });
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  get isConfigured() {
    return Boolean(this.config.baseUrl && this.config.companyId && this.config.companySecret);
  }

  base() {
    return String(this.config.baseUrl).replace(/\/$/, '');
  }

  async accessToken() {
    requireConfig(this, ['baseUrl', 'companyId', 'companySecret']);
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const data = await fetchJson(`${this.base()}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company_id: this.config.companyId,
        company_secret: this.config.companySecret,
      }),
      timeoutMs: 20_000,
    });

    if (!data?.access_token) {
      throw new Error('LUGI: token endpoint returned no access_token');
    }
    this.token = data.access_token;
    // Refresh a minute early; providers usually issue 1h tokens.
    this.tokenExpiresAt = Date.now() + Math.max((data.expires_in ?? 3600) - 60, 60) * 1000;
    return this.token;
  }

  mapProduct(item) {
    const costCents = Number.isFinite(item?.price_cents)
      ? item.price_cents
      : Math.round(Number(item?.price ?? 0) * 100);
    if (!Number.isFinite(costCents) || costCents <= 0) return null;

    const images = (item.images ?? item.pictures ?? [])
      .map((image) => (typeof image === 'string' ? image : image?.url))
      .filter((src) => typeof src === 'string' && src.startsWith('http'));
    if (images.length === 0) return null;

    const title = collapseWhitespace(item.name ?? item.title ?? '');
    if (!title) return null;

    return {
      externalId: String(item.id ?? item.sku),
      title,
      description: stripHtml(item.description ?? item.short_description ?? ''),
      imageUrl: images[0],
      images,
      costCents,
      currency: item.currency ?? 'UAH',
      stock: Number(item.quantity ?? item.stock ?? 0),
      categoryRaw: item.category?.name ?? item.category ?? '',
      categoryPath: Array.isArray(item.category_path) ? item.category_path : [],
      productUrl: item.url ?? '',
      vendor: item.brand ?? item.vendor ?? '',
      attributes: [],
      supplierId: this.id,
    };
  }

  async healthCheck() {
    if (!this.isConfigured) return false;
    try {
      await this.accessToken();
      return true;
    } catch (error) {
      this.logger.warn('health check failed', { error: error.message });
      return false;
    }
  }

  async *fetchProducts({ maxProducts = 8000, pageSize = 100 } = {}) {
    requireConfig(this, ['baseUrl', 'companyId', 'companySecret']);
    let cursor = null;
    let yielded = 0;

    while (yielded < maxProducts) {
      const token = await this.accessToken();
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) query.set('cursor', cursor);

      const page = await fetchJson(`${this.base()}/api/v1/products?${query}`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 45_000,
      });

      const items = page?.items ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        const mapped = this.mapProduct(item);
        if (!mapped) continue;
        yield mapped;
        yielded += 1;
        if (yielded >= maxProducts) return;
      }

      cursor = page?.next_cursor ?? null;
      if (!cursor) break;
    }
  }

  /** Sends the order to LUGI. Returns {status, ref}. */
  async placeOrder({ order, items, customer }) {
    requireConfig(this, ['baseUrl', 'companyId', 'companySecret']);
    const token = await this.accessToken();

    const payload = {
      external_id: order.id,
      customer: {
        name: customer.fullName,
        phone: customer.phone,
        city: customer.city,
        warehouse: customer.branch,
        comment: customer.comment ?? '',
      },
      delivery: { provider: 'nova_poshta', payment: 'cod' },
      items: items.map((item) => ({
        sku: item.externalId ?? item.productId,
        quantity: item.qty,
        price: item.unitPriceCents,
      })),
    };

    const response = await fetch(`${this.base()}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = new Error(`LUGI order API responded ${response.status}`);
      error.code = 'order_api_unsupported';
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    return { status: 'sent', ref: data.id ?? data.order_id ?? order.id };
  }
}

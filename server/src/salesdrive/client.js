import { AppError } from '../core/errors.js';

/**
 * Minimal SalesDrive API client.
 * Auth: X-Api-Key header. Account-specific base URL, e.g. https://myaccount.salesdrive.me
 */
export class SalesDriveClient {
  constructor({ baseUrl, apiKey, timeoutMs = 20_000, retries = 2, logger }) {
    this.baseUrl = String(baseUrl ?? '').replace(/\/$/, '');
    this.apiKey = apiKey ?? '';
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.logger = logger;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async request(path, { method = 'POST', body } = {}) {
    if (!this.configured) {
      throw new AppError('SalesDrive не налаштований', { code: 'salesdrive_not_configured', status: 503 });
    }

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'X-Api-Key': this.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text.slice(0, 500) };
        }

        if (!response.ok) {
          const error = new AppError(`SalesDrive HTTP ${response.status}`, {
            code: 'salesdrive_http_error',
            status: 502,
            details: { status: response.status, body: data },
          });
          // 4xx (bad payload/auth) must not be retried.
          if (response.status >= 400 && response.status < 500) throw error;
          lastError = error;
          if (attempt < this.retries) continue;
          throw error;
        }

        this.logger?.info('salesdrive request ok', { path, attempt: attempt + 1 });
        return data;
      } catch (error) {
        if (error.code === 'salesdrive_http_error' && error.details?.status < 500) throw error;
        lastError = error;
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        throw new AppError(`SalesDrive недоступний: ${error.message}`, {
          code: 'salesdrive_unreachable',
          status: 502,
          details: { cause: error.message },
        });
      }
    }
    throw lastError;
  }

  /** Creates an order through the website form handler (supports the full NP block). */
  async createOrder(payload) {
    const data = await this.request('/handler/', { method: 'POST', body: payload });
    const ok = data?.success !== false;
    if (!ok) {
      throw new AppError('SalesDrive відхилив замовлення', {
        code: 'salesdrive_rejected',
        status: 502,
        details: data,
      });
    }
    const orderId = data?.data?.id ?? data?.id ?? null;
    return { id: orderId, raw: data };
  }

  async statuses() {
    return this.request('/api/statuses/', { method: 'GET' });
  }

  async paymentMethods() {
    return this.request('/api/payment-methods/', { method: 'GET' });
  }

  async deliveryMethods() {
    return this.request('/api/delivery-methods/', { method: 'GET' });
  }
}

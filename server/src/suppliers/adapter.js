/**
 * Every supplier integration implements this contract.
 * The sync engine and the order router never know supplier specifics.
 */
export class SupplierAdapter {
  /**
   * @param {{id: string, name: string, config: object, logger: object}} options
   */
  constructor({ id, name, config, logger }) {
    if (new.target === SupplierAdapter) {
      throw new Error('SupplierAdapter is abstract');
    }
    this.id = id;
    this.name = name;
    this.config = config ?? {};
    this.logger = logger;
  }

  get isConfigured() {
    return true;
  }

  /** @returns {Promise<boolean>} */
  async healthCheck() {
    return this.isConfigured;
  }

  /**
   * Streams normalised products from the supplier.
   * Must yield objects shaped like `normalizeRawProduct` output.
   * @param {{maxProducts?: number, pageSize?: number}} [options]
   * @returns {AsyncGenerator<object>}
   */
  // eslint-disable-next-line require-yield
  async *fetchProducts() {
    throw new Error(`${this.constructor.name}.fetchProducts() is not implemented`);
  }

  /**
   * Sends an order to the supplier.
   * Return `{ status: 'sent', ref }` or `{ status: 'queued', ref }` when using the email outbox.
   * @param {{order: object, items: object[], customer: object}} payload
   */
  async placeOrder() {
    throw new Error(`${this.constructor.name}.placeOrder() is not implemented`);
  }
}

/** Shared helper: asserts required config keys and produces a readable error. */
export function requireConfig(adapter, keys) {
  const missing = keys.filter((key) => !adapter.config[key]);
  if (missing.length > 0) {
    const error = new Error(`${adapter.name}: missing configuration: ${missing.join(', ')}`);
    error.code = 'not_configured';
    throw error;
  }
}

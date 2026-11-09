/**
 * Nova Poshta waybills (InternetDocument).
 * Fully inert unless NOVA_POSHTA_API_KEY and the sender references are set,
 * so the order flow never blocks on logistics.
 */
/**
 * Pure payload builder (unit-tested): COD is sent as BackwardDeliveryData so
 * Nova Poshta collects the goods amount from the recipient and pays it to the
 * sender's NP account.
 */
export function buildWaybillPayload({
  order, customer, totalCents, weight, cityRef, warehouseRef,
  sender, cod = true,
}) {
  const amount = (totalCents / 100).toFixed(2);
  return {
    PayerType: 'Recipient',
    PaymentMethod: 'Cash',
    DateTime: new Date().toLocaleDateString('uk-UA'),
    CargoType: 'Parcel',
    Weight: String(weight),
    ServiceType: 'WarehouseWarehouse',
    SeatsAmount: '1',
    Description: `Замовлення ${order.id}`,
    Cost: String(Math.round(totalCents / 100)),
    CitySender: sender.cityRef,
    Sender: sender.ref,
    SenderAddress: sender.warehouseRef ?? '',
    ContactSender: sender.contactRef,
    SendersPhone: sender.phone,
    CityRecipient: cityRef,
    RecipientAddress: warehouseRef,
    RecipientName: customer.fullName,
    RecipientsPhone: customer.phone,
    NewAddress: '1',
    ...(cod
      ? { BackwardDeliveryData: [{ PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: amount }] }
      : {}),
  };
}

export class NovaPoshtaService {
  constructor({ apiKey, senderRef, senderContactRef, senderPhone, senderCityRef, senderWarehouseRef, cod = true, logger }) {
    this.apiKey = apiKey ?? '';
    this.senderRef = senderRef ?? '';
    this.senderContactRef = senderContactRef ?? '';
    this.senderPhone = senderPhone ?? '';
    this.senderCityRef = senderCityRef ?? '';
    this.cod = cod !== false;
    this.logger = logger;
    this.endpoint = 'https://api.novaposhta.ua/v2.0/json/';
  }

  get configured() {
    return Boolean(this.apiKey && this.senderRef && this.senderContactRef && this.senderCityRef);
  }

  async call(modelName, calledMethod, methodProperties) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: this.apiKey,
        modelName,
        calledMethod,
        methodProperties,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!data?.success) {
      throw new Error(`${modelName}.${calledMethod}: ${(data?.errors ?? []).join('; ') || 'unknown error'}`);
    }
    return data.data;
  }

  async resolveCityRef(cityName) {
    const data = await this.call('Address', 'getCities', { FindByString: cityName, Limit: '1' });
    return data?.[0]?.Ref ?? null;
  }

  async resolveWarehouseRef(cityRef, description) {
    const data = await this.call('Address', 'getWarehouses', {
      CityRef: cityRef,
      FindByString: description,
      Limit: '1',
    });
    return data?.[0]?.Ref ?? null;
  }

  async searchCities(query, limit = 20) {
    if (!this.apiKey) return [];
    const data = await this.call('Address', 'getCities', { FindByString: query, Limit: String(limit) });
    return (data ?? []).map((row) => ({ name: row.Description, ref: row.Ref }));
  }

  async searchWarehouses(cityName, query, limit = 50) {
    if (!this.apiKey) return [];
    const cityRef = await this.resolveCityRef(cityName);
    if (!cityRef) return [];
    const data = await this.call('Address', 'getWarehouses', {
      CityRef: cityRef,
      FindByString: query ?? '',
      Limit: String(limit),
    });
    return (data ?? []).map((row) => ({ name: row.Description, ref: row.Ref }));
  }

  /** @returns {Promise<{ttn: string} | null>} null when not configured. */
  async createWaybill({ order, customer, items, totalCents }) {
    if (!this.configured) return null;

    const cityRef = await this.resolveCityRef(customer.city);
    if (!cityRef) throw new Error(`NP: city not found: ${customer.city}`);
    const warehouseRef = await this.resolveWarehouseRef(cityRef, customer.branch);
    if (!warehouseRef) throw new Error(`NP: warehouse not found: ${customer.branch}`);

    const weight = Math.max(0.5, items.reduce((sum, item) => sum + item.qty, 0) * 0.4);
    const data = await this.call('InternetDocument', 'save', buildWaybillPayload({
      order,
      customer,
      totalCents,
      weight,
      cityRef,
      warehouseRef,
      cod: this.cod,
      sender: {
        ref: this.senderRef,
        contactRef: this.senderContactRef,
        phone: this.senderPhone,
        cityRef: this.senderCityRef,
        warehouseRef: this.senderWarehouseRef,
      },
    }));

    const ttn = data?.[0]?.IntDocNumber ?? null;
    if (!ttn) return null;
    this.logger?.info('NP waybill created', { orderId: order.id, ttn });
    return { ttn };
  }

  static trackingUrl(ttn) {
    return ttn ? `https://tracking.novaposhta.ua/#/uk/result?numbers=${encodeURIComponent(ttn)}` : null;
  }
}

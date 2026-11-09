import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaybillPayload } from '../src/services/novaPoshta.js';

const base = {
  order: { id: 'MA-1' }, customer: { fullName: 'Шевчук Петро', phone: '+380671234567' },
  totalCents: 65800, weight: 0.8, cityRef: 'city', warehouseRef: 'wh',
  sender: { ref: 's', contactRef: 'c', phone: '+380441112233', cityRef: 'sc', warehouseRef: 'sw' },
};

test('COD is collected from the recipient', () => {
  const p = buildWaybillPayload(base);
  assert.equal(p.PayerType, 'Recipient');
  assert.equal(p.Cost, '658');
  assert.deepEqual(p.BackwardDeliveryData, [{ PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: '658.00' }]);
});

test('COD can be disabled', () => {
  const p = buildWaybillPayload({ ...base, cod: false });
  assert.equal(p.BackwardDeliveryData, undefined);
});

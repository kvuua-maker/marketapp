import test from 'node:test';
import assert from 'node:assert/strict';
import { roundToNine, retailPrice, formatUah } from '../src/domain/pricing.js';

test('roundToNine always ends with 9', () => {
  assert.equal(roundToNine(14900), 14900);
  assert.equal(roundToNine(15000), 15900);
  assert.equal(roundToNine(149600), 149900);
  assert.equal(roundToNine(101), 200);
});

test('retailPrice applies margin and rounding', () => {
  const { priceCents, marginPercent } = retailPrice(10000, 15, { rounding: 'x9' });
  assert.equal(marginPercent, 15);
  // 100 UAH * 1.15 = 115 -> nearest x9 = 119
  assert.equal(priceCents, 11900);
});

test('retailPrice never sells below cost', () => {
  const { priceCents } = retailPrice(10000, 0, { rounding: 'none', minMarginPercent: 0 });
  assert.ok(priceCents > 10000);
});

test('retailPrice rejects invalid cost', () => {
  assert.throws(() => retailPrice(0, 15));
  assert.throws(() => retailPrice(Number.NaN, 15));
});

test('formatUah renders hryvnia', () => {
  assert.match(formatUah(149900), /1\s?499/);
  assert.match(formatUah(149900), /₴/);
});

test('margin is applied on top of wholesale price', () => {
  const cost = 639000; // 6390 UAH
  const { priceCents } = retailPrice(cost, 15, { rounding: 'x9' });
  assert.ok(priceCents >= cost * 1.15);
  assert.equal(Math.floor(priceCents / 100) % 10, 9);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeedPrice,
  isSupportedCurrency,
  resolveImageUrl,
  MIN_PRICE_CENTS,
  MAX_PRICE_CENTS,
} from '../src/domain/priceParser.js';

test('parses separators the way supplier feeds write them', () => {
  assert.equal(parseFeedPrice('1 299,00'), 129900);
  assert.equal(parseFeedPrice('1.299,00'), 129900);
  assert.equal(parseFeedPrice('1,299.00'), 129900);
  assert.equal(parseFeedPrice('1299.00'), 129900);
  assert.equal(parseFeedPrice('1299'), 129900);
  assert.equal(parseFeedPrice('99,9 грн'), 9990);
  assert.equal(parseFeedPrice('  89.50 UAH '), 8950);
});

test('rejects implausible prices instead of selling for 1 UAH', () => {
  assert.equal(parseFeedPrice('0,50'), null);
  assert.equal(parseFeedPrice('9.99'), null);
  assert.equal(parseFeedPrice('12 000 000'), null);
  assert.equal(parseFeedPrice('abc'), null);
  assert.equal(parseFeedPrice(''), null);
  assert.equal(parseFeedPrice(null), null);
  assert.ok(MIN_PRICE_CENTS >= 1000);
  assert.ok(MAX_PRICE_CENTS <= 1_000_000_000);
});

test('only UAH is accepted', () => {
  assert.equal(isSupportedCurrency('UAH'), true);
  assert.equal(isSupportedCurrency('грн'), true);
  assert.equal(isSupportedCurrency(''), true);
  assert.equal(isSupportedCurrency('USD'), false);
  assert.equal(isSupportedCurrency('EUR'), false);
});

test('relative image URLs are resolved', () => {
  assert.equal(resolveImageUrl('/img/a.jpg', 'https://shop.ua'), 'https://shop.ua/img/a.jpg');
  assert.equal(resolveImageUrl('//cdn.shop.ua/a.jpg', 'https://shop.ua'), 'https://cdn.shop.ua/a.jpg');
  assert.equal(resolveImageUrl('https://cdn/a.jpg', 'https://shop.ua'), 'https://cdn/a.jpg');
  assert.equal(resolveImageUrl('a.jpg', 'https://shop.ua'), null);
  assert.equal(resolveImageUrl('', 'https://shop.ua'), null);
});

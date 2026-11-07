import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePrice, marginPercent, DEFAULTS } from '../src/pricing/engine.js';
import { matchScore, pickCheapestMatch } from '../src/pricing/matcher.js';
import { parsePromHtml } from '../src/pricing/competitors.js';

const rules = { ...DEFAULTS };

test('no competitor data keeps the current price (parser guard)', () => {
  const decision = decidePrice({
    costCents: 50_000,
    currentPriceCents: 63_900,
    competitorPrices: [],
    options: rules,
  });
  assert.equal(decision.status, 'no_data');
  assert.equal(decision.priceCents, 63_900);
});

test('dumping competitors below cost are ignored and the floor is applied', () => {
  const decision = decidePrice({
    costCents: 50_000,
    currentPriceCents: 63_900,
    competitorPrices: [10_000, 20_000],
    options: rules,
  });
  assert.equal(decision.status, 'floor');
  assert.equal(decision.priceCents, 57_900, '500 + 15% rounded to x9 = 579');
});

test('undercut 2% with x9 rounding', () => {
  const decision = decidePrice({
    costCents: 50_000,
    currentPriceCents: 60_000,
    competitorPrices: [60_000],
    options: rules,
  });
  assert.equal(decision.status, 'updated');
  assert.equal(decision.priceCents, 58_900, '600 - 2% = 588 -> 589');
});

test('ceiling caps the price when the competitor is very expensive', () => {
  const decision = decidePrice({
    costCents: 50_000,
    currentPriceCents: 70_000,
    competitorPrices: [100_000],
    options: rules,
  });
  assert.equal(decision.priceCents, 74_900, 'max margin 50% -> 750 capped, x9 -> 749');
});

test('the floor is never breached', () => {
  const decision = decidePrice({
    costCents: 30_000,
    currentPriceCents: 40_000,
    competitorPrices: [34_000],
    options: rules,
  });
  assert.equal(decision.priceCents, 34_900, 'cost 300 + 15% = 345 -> 349');
});

test('a change above 30% pauses the product and keeps the price', () => {
  const decision = decidePrice({
    costCents: 30_000,
    currentPriceCents: 100_000,
    competitorPrices: [50_000],
    options: rules,
  });
  assert.equal(decision.status, 'paused');
  assert.equal(decision.priceCents, 100_000);
  assert.match(decision.reason, /exceeds 30%/);
});

test('margin helper is percent over cost', () => {
  assert.equal(Number(marginPercent(62_500, 50_000).toFixed(2)), 25);
});

test('matcher prefers the relevant offer and ignores unrelated ones', () => {
  const product = 'Кронштейн для телевізора HDL-117B VESA 14-42';
  const relevant = 'Кронштейн для телевізора HDL-117B VESA 14-42 дюйма';
  const unrelated = 'Чохол для телефону силіконовий';

  assert.ok(matchScore(product, relevant) >= 0.5);
  assert.ok(matchScore(product, unrelated) < 0.5);

  const best = pickCheapestMatch(product, [
    { title: relevant, priceCents: 45_000, url: 'a' },
    { title: 'Кронштейн для телевізора HDL-117B VESA 14-42 дюйма (інший)', priceCents: 39_000, url: 'b' },
    { title: unrelated, priceCents: 1_000, url: 'c' },
  ]);
  assert.equal(best.priceCents, 39_000);
});

test('Prom HTML parser extracts title, url and price', () => {
  const html = `
    <a title="Кронштейн для телевізора &quot;HDL&quot;" data-speculative-prefetch="true"
       data-qaid="product_link" href="/ua/p1-kronshtejn.html">link</a>
    <div data-qaid="product_price" data-qaprice="497" data-qacurrency="₴/шт.">497 ₴</div>
    <a title="Інший товар" data-qaid="product_link" href="https://prom.ua/ua/p2.html">x</a>
    <div data-qaid="product_price" data-qaprice="1234.50">1234.5 ₴</div>`;
  const offers = parsePromHtml(html);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].priceCents, 49_700);
  assert.equal(offers[0].url, 'https://prom.ua/ua/p1-kronshtejn.html');
  assert.match(offers[0].title, /HDL/);
  assert.equal(offers[1].priceCents, 123_450);
});

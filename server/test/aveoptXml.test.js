import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AveoptXmlAdapter } from '../src/suppliers/aveoptXml.js';
import { formatSyncSummary, telegramConfigured } from '../src/services/telegram.js';
import { logger } from './helpers.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-11-07 08:00">
  <shop>
    <categories>
      <category id="1">Техніка для кухні</category>
      <category id="2">Краса та здоровʼя</category>
    </categories>
    <offers>
      <offer id="1001" available="true">
        <price>1 299,00</price>
        <currencyId>UAH</currencyId>
        <categoryId>1</categoryId>
        <picture>https://cdn.aveopt.com.ua/img/1001.jpg</picture>
        <name>Електрична каструля RAF R.5427, 2,5 л</name>
        <vendor>RAF</vendor>
        <description><![CDATA[<p>Потужність 650 Вт, обʼєм 2,5 л.</p>]]></description>
        <quantity_in_stock>3</quantity_in_stock>
        <url>https://www.aveopt.com.ua/product/1001</url>
      </offer>
      <offer id="1002" available="false">
        <price>0,50</price>
        <currencyId>UAH</currencyId>
        <categoryId>2</categoryId>
        <picture>https://cdn.aveopt.com.ua/img/1002.jpg</picture>
        <name>Дешевий товар</name>
        <quantity_in_stock>1</quantity_in_stock>
      </offer>
      <offer id="1003" available="true">
        <price>899</price>
        <currencyId>USD</currencyId>
        <categoryId>2</categoryId>
        <picture>https://cdn.aveopt.com.ua/img/1003.jpg</picture>
        <name>Товар у доларах</name>
        <quantity_in_stock>1</quantity_in_stock>
      </offer>
      <offer id="1004" available="true">
        <price>549</price>
        <currencyId>UAH</currencyId>
        <categoryId>1</categoryId>
        <name>Товар без фото</name>
        <quantity_in_stock>1</quantity_in_stock>
      </offer>
    </offers>
  </shop>
</yml_catalog>`;

function adapterWithFeed() {
  const dir = mkdtempSync(join(tmpdir(), 'aveopt-yml-'));
  const path = join(dir, 'aveopt.yml');
  writeFileSync(path, FEED, 'utf8');
  return new AveoptXmlAdapter({
    config: { xmlPath: path },
    logger: logger.child({ supplier: 'aveopt-xml-test' }),
  });
}

test('Aveopt XML adapter maps a YML offer and rejects bad rows', async () => {
  const adapter = adapterWithFeed();
  assert.equal(adapter.id, 'aveopt');
  assert.equal(adapter.isConfigured, true);
  assert.equal(adapter.feedOrigin(), 'https://www.aveopt.com.ua');

  const products = [];
  for await (const product of adapter.fetchProducts()) products.push(product);

  assert.equal(products.length, 1, 'only the valid UAH offer with a photo survives');
  const product = products[0];
  assert.equal(product.externalId, '1001');
  assert.equal(product.costCents, 129900, '1 299,00 -> 129900 cents');
  assert.equal(product.currency, 'UAH');
  assert.equal(product.stock, 3);
  assert.equal(product.categoryRaw, 'Техніка для кухні', 'categoryId resolved through <categories>');
  assert.equal(product.vendor, 'RAF');
  assert.equal(product.imageUrl, 'https://cdn.aveopt.com.ua/img/1001.jpg');
  assert.match(product.description, /650 Вт/);
  assert.equal(product.supplierId, 'aveopt');
});

test('telegram summary is human readable and respects configuration', () => {
  assert.equal(telegramConfigured({ notifications: { telegram: { token: '', chatId: '' } } }), false);
  assert.equal(telegramConfigured({ notifications: { telegram: { token: 't', chatId: 'c' } } }), true);

  const text = formatSyncSummary({
    reason: 'interval',
    results: [{ supplierId: 'aveopt', counters: { fetched: 6454, published: 6394, updated: 6394, rejected: 0, duplicates: 60 } }],
    catalog: { products: 6395, inStock: 2658 },
  });
  assert.match(text, /MarketApp sync \(interval\)/);
  assert.match(text, /aveopt: fetched 6454/);
  assert.match(text, /Каталог: 6395 товарів \/ 2658 в наявності/);

  const failure = formatSyncSummary({ reason: 'interval', error: new Error('feed timeout') });
  assert.match(failure, /sync failed/);
  assert.match(failure, /feed timeout/);
});

test('Dropt adapter prefixes ids and keeps the supplier/feed id separate', async () => {
  const { DroptAdapter } = await import('../src/suppliers/dropt.js');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-11-07 08:00"><shop>
  <currencies><currency id="UAH" rate="1"/></currencies>
  <categories><category id="63">Побутова техніка</category></categories>
  <offers>
    <offer id="555" available="true">
      <price>1000</price>
      <currencyId>UAH</currencyId>
      <categoryId>63</categoryId>
      <picture>https://cdn.dropt.in.ua/555.jpg</picture>
      <name>Пилосос Dropt D-555</name>
      <description><![CDATA[Потужний пилосос для дому та авто, 2000 Вт, контейнер 2 л.]]></description>
      <quantity_in_stock>4</quantity_in_stock>
    </offer>
  </offers>
</shop></yml_catalog>`;

  const dir = mkdtempSync(join(tmpdir(), 'dropt-yml-'));
  const path = join(dir, 'dropt.yml');
  writeFileSync(path, feed, 'utf8');

  const adapter = new DroptAdapter({ config: { xmlPath: path, idPrefix: 'dropt_' }, logger });
  assert.equal(adapter.id, 'dropt');
  assert.equal(adapter.feedOrigin(), 'https://dropt.in.ua');

  const products = [];
  for await (const product of adapter.fetchProducts()) products.push(product);
  assert.equal(products.length, 1);
  assert.equal(products[0].externalId, '555');
  assert.equal(products[0].idPrefix, 'dropt_');
  assert.equal(`${products[0].idPrefix}${products[0].externalId}`, 'dropt_555');
  assert.equal(products[0].supplierId, 'dropt');
  assert.equal(products[0].costCents, 100000);
  assert.equal(products[0].categoryRaw, 'Побутова техніка');
});

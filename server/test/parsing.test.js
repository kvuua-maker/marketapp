import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBlocks, childText, childTexts, cleanFeedText } from '../src/suppliers/xml.js';
import { classifyCategory, coerceCategory, CANONICAL_CATEGORIES } from '../src/domain/categories.js';
import { detectLanguage, stripHtml, firstSentences, normalizeTitle } from '../src/domain/text.js';

const YML = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-11-03 10:00">
  <shop>
    <categories>
      <category id="10">Електроніка</category>
      <category id="11" parentId="10">Навушники</category>
    </categories>
    <offers>
      <offer id="501" available="true">
        <name><![CDATA[Бездротові навушники Test X1]]></name>
        <description><![CDATA[<p>Гарний звук</p><p>До 20 годин роботи</p>]]></description>
        <price>1299.50</price>
        <currencyId>UAH</currencyId>
        <categoryId>11</categoryId>
        <picture>https://cdn.example.com/1.jpg</picture>
        <picture>https://cdn.example.com/2.jpg</picture>
        <vendor>Test</vendor>
        <quantity_in_stock>7</quantity_in_stock>
      </offer>
      <offer id="502">
        <name>Пилосос Test V2</name>
        <description>Потужний пилосос &amp; аксесуари</description>
        <price>3999</price>
        <picture>https://cdn.example.com/3.jpg</picture>
      </offer>
    </offers>
  </shop>
</yml_catalog>`;

test('extractBlocks parses offers with CDATA and multiple pictures', () => {
  const blocks = extractBlocks(YML);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].attributes.id, '501');
  assert.equal(childText(blocks[0], 'name'), 'Бездротові навушники Test X1');
  assert.deepEqual(childTexts(blocks[0], 'picture'), [
    'https://cdn.example.com/1.jpg',
    'https://cdn.example.com/2.jpg',
  ]);
  assert.equal(childText(blocks[0], 'price'), '1299.50');
});

test('extractBlocks decodes entities in plain text', () => {
  const [, second] = extractBlocks(YML);
  assert.equal(childText(second, 'description'), 'Потужний пилосос & аксесуари');
});

test('extractBlocks reads block-level text (category names)', () => {
  const categories = extractBlocks(YML, ['category']);
  assert.equal(categories.length, 2);
  assert.equal(categories[0].text.trim(), 'Електроніка');
  assert.equal(categories[1].attributes.parentId, '10');
});

test('cleanFeedText strips html from CDATA', () => {
  const [first] = extractBlocks(YML);
  const text = cleanFeedText(childText(first, 'description'));
  assert.match(text, /Гарний звук/);
  assert.doesNotMatch(text, /<p>/);
});

test('classifyCategory maps common electronics', () => {
  assert.equal(classifyCategory({ title: 'Бездротові навушники AirPods 3', categoryRaw: '' }), 'Навушники');
  assert.equal(classifyCategory({ title: 'Смартфон Samsung Galaxy S24', categoryRaw: '' }), 'Смартфони');
  assert.equal(classifyCategory({ title: 'Ноутбук ASUS VivoBook 15', categoryRaw: '' }), 'Ноутбуки');
  assert.equal(classifyCategory({ title: 'Пилосос Dyson V12', categoryRaw: '' }), 'Побутова техніка');
  assert.equal(classifyCategory({ title: 'Шуруповерт Makita', categoryRaw: '' }), 'Інструменти');
  assert.equal(classifyCategory({ title: 'Невідомий товар', categoryRaw: '' }), 'Інше');
});

test('coerceCategory accepts model value or falls back to rules', () => {
  assert.equal(coerceCategory('Смартфони'), 'Смартфони');
  assert.equal(coerceCategory('смартфони'), 'Смартфони');
  assert.equal(coerceCategory('Smartphones', { title: 'Телевізор LG 55' }), 'Телевізори');
  assert.ok(CANONICAL_CATEGORIES.includes(coerceCategory('Выдуманная категория', { title: 'Ноутбук' })));
});

test('text helpers behave', () => {
  assert.equal(stripHtml('<p>Привіт&nbsp;<b>світ</b></p>'), 'Привіт світ');
  assert.equal(detectLanguage('Навушники бездротові'), 'uk');
  assert.equal(detectLanguage('Наушники беспроводные'), 'ru');
  assert.equal(normalizeTitle('  тестовий   товар  '), 'Тестовий товар');
  assert.ok(firstSentences('Перше речення. Друге речення. Третє.', 25).length <= 26);
});

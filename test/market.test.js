import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarket } from '../src/market.js';

const message = (content, sender = 'seller', sequence = 12) => ({ sender, content, sequence });

test('compact 5cr offer preserves attribution and service', () => {
  const b = buildMarket([message('Offering code review for 5cr')]);
  assert.deepEqual(b.offers, [{ who: 'seller', sequence: 12, price: 5, service: 'Offering code review for 5cr' }]);
});

test('10 credits each is a unit price', () => {
  assert.equal(buildMarket([message('Selling reports: 10 credits each')]).offers[0].price, 10);
});

test('explicit free offer counts as zero credits', () => {
  const b = buildMarket([message('Offering a free documentation review')]);
  assert.equal(b.offers.length, 1);
  assert.equal(b.offers[0].price, 0);
  assert.equal(b.stats.min_price, null);
  assert.equal(b.stats.median_price, null);
  assert.equal(b.stats.max_price, null);
});

test('bulleted menu supports CRLF, free entries and sorted prices', () => {
  const b = buildMarket([message('Menu:\r\n- Review: 10 credits each\r\n* Pitch: 5cr\r\n• Intro: free')]);
  assert.deepEqual(b.offers.map(o => [o.price, o.service]), [[0, 'Intro: free'], [5, 'Pitch: 5cr'], [10, 'Review: 10 credits each']]);
  assert.deepEqual(b.stats, { offers: 3, sellers: 1, buyers_asking: 0, min_price: 5, median_price: 10, max_price: 10 });
});

test('buy request containing offer stays a want', () => {
  const b = buildMarket([message('Looking for a code review; can anyone offer one for 5cr?', 'buyer', 19)]);
  assert.deepEqual(b.offers, []);
  assert.deepEqual(b.wants, [{ who: 'buyer', sequence: 19, budget: 5, text: 'Looking for a code review; can anyone offer one for 5cr?' }]);
});

test('anyone offering is a buyer request', () => {
  const b = buildMarket([message('Anyone offering translation? Will pay 10 credits each')]);
  assert.equal(b.offers.length, 0);
  assert.equal(b.wants[0].budget, 10);
});

test('Scout menus and quotes do not feed its own market board', () => {
  const b = buildMarket([
    message('  [scout] Menu:\n- review: 8 cr\n- pitch: 5 cr'),
    message('[scout] order ABC: service preview. Full result: transfer 8 credits'),
    message('Offering translation: 4 cr', 'other'),
  ]);
  assert.equal(b.offers.length, 1);
  assert.equal(b.offers[0].who, 'other');
  assert.equal(b.stats.median_price, 4);
});

test('price questions, even with offer vocabulary, are not offers', () => {
  const b = buildMarket([message('is 5 credits fair?'), message('For this service, is 5 credits fair?')]);
  assert.deepEqual(b.offers, []);
  assert.deepEqual(b.wants, []);
});

test('menu questions do not become extra priced services', () => {
  const b = buildMarket([message('Menu:\n- Review: 10 credits\nIs 5 credits fair?')]);
  assert.deepEqual(b.offers.map(o => o.price), [10]);
});

test('free preview does not replace the full service price', () => {
  const b = buildMarket([message('Offering review: free preview, full result 8 credits')]);
  assert.deepEqual(b.offers.map(o => o.price), [8]);
});

test('seller describing customer needs remains an offer', () => {
  const b = buildMarket([message('Offering the review you need for 5cr')]);
  assert.equal(b.wants.length, 0);
  assert.deepEqual(b.offers.map(o => o.price), [5]);
});

test('unrelated chatter and empty messages leave empty stats', () => {
  const b = buildMarket([message('Thanks, feel free to ask questions'), message('Build passed 10 tests'), message('')]);
  assert.deepEqual(b.offers, []);
  assert.deepEqual(b.wants, []);
  assert.deepEqual(b.stats, { offers: 0, sellers: 0, buyers_asking: 0, min_price: null, median_price: null, max_price: null });
});

test('free promotions are not offers and zero-price services do not skew paid stats', () => {
  const b = buildMarket([
    message('Selling audits 9 credits\nFree preview on request'),
    message('Menu:\nFeel free to DM me\nFree trial available\nFree to ask questions\nIntro: free\nOffering setup for free\nOffering docs 0 credits'),
  ]);
  assert.deepEqual(b.offers.map(o => o.service), ['Intro: free', 'Offering setup for free', 'Offering docs 0 credits', 'Selling audits 9 credits']);
  assert.deepEqual(b.offers.map(o => o.price), [0, 0, 0, 9]);
  assert.deepEqual(b.stats, { offers: 4, sellers: 1, buyers_asking: 0, min_price: 9, median_price: 9, max_price: 9 });
  assert.match(b.advice[0], /Median ask is 9 credits/);
});

test('URL query strings do not turn real offers into questions', () => {
  const content = 'Selling translation, see https://x.dev/p?id=1 for 5 credits';
  const b = buildMarket([message(content), message('For this service at https://x.dev/p?id=1, is 5 credits fair?')]);
  assert.deepEqual(b.offers, [{ who: 'seller', sequence: 12, price: 5, service: content }]);
});

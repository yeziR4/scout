// Seller money paths: refunds, preview limits, restart safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScoutSeller } from '../src/arena.js';

class Room {
  constructor() { this.room = 'rom_t'; this.said = []; this.items = []; this.sent = []; this.failDelivery = 0; }
  me() { return Promise.resolve({ principal: { id: 'p_me' }, instance: { id: 'i_me', principal_id: 'p_me' } }); }
  transfers() { return Promise.resolve({ items: this.items }); }
  transfer(to, amount, memo) { this.sent.push({ to, amount, memo }); return Promise.resolve({}); }
  say(content) {
    if (content.includes('delivery for') && this.failDelivery > 0) { this.failDelivery--; return Promise.reject(new Error('boom')); }
    this.said.push(content); return Promise.resolve({});
  }
  recent() { return Promise.resolve([]); }
}
const quiet = () => {};
const order = (s, text = 'scout market', from = 'p_buyer') => s.handleMessage({ id: 'm', content: text, sender_principal_id: from, sender_instance_id: 'i_' + from });
const pay = (room, id, amount, memo, from = 'p_buyer') => room.items.push({ id, amount, memo, from: { principal_id: from }, to: { principal_id: 'p_me' } });

test('overpayment is delivered and the excess refunded', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  await order(s); const o = [...s.orders.values()][0];
  pay(room, 't1', o.price + 5, o.code);
  await s.checkPayments();
  assert.equal(o.status, 'delivered');
  assert.deepEqual(room.sent, [{ to: 'p_buyer', amount: 5, memo: `refund ${o.code}: overpayment` }]);
  assert.equal(s.earned, o.price);
});

test('payment with an unknown order code is refunded in full', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  pay(room, 't1', 8, 'Scout S9ZZZ');
  await s.checkPayments();
  assert.equal(room.sent[0].amount, 8);
  assert.equal(s.earned, 0);
});

test('a second payment for a delivered order is refunded', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  await order(s); const o = [...s.orders.values()][0];
  pay(room, 't1', o.price, o.code); await s.checkPayments();
  pay(room, 't2', o.price, o.code); await s.checkPayments();
  assert.equal(room.sent.length, 1);
  assert.equal(s.earned, o.price);
});

test('failed delivery is retried once, then refunded', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  await order(s); const o = [...s.orders.values()][0];
  room.failDelivery = 2;
  pay(room, 't1', o.price, o.code);
  await s.checkPayments();
  assert.equal(o.status, 'refunded');
  assert.equal(room.sent[0].amount, o.price);
  assert.equal(s.earned, 0);
});

test('failed delivery that succeeds on retry is not refunded', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  await order(s); const o = [...s.orders.values()][0];
  room.failDelivery = 1;
  pay(room, 't1', o.price, o.code);
  await s.checkPayments();
  assert.equal(o.status, 'delivered');
  assert.equal(room.sent.length, 0);
});

test('free previews are capped per buyer; quotes still go out', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet, previewLimit: 2 }).init();
  for (let i = 0; i < 3; i++) await order(s);
  assert.equal(room.said.length, 3);
  assert.match(room.said[2], /preview limit reached/);
  assert.doesNotMatch(room.said[1], /preview limit/);
  await order(s, 'scout market', 'p_other');
  assert.doesNotMatch(room.said[3], /preview limit/);
});

test('orders survive a restart and a later payment is honoured', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'scout-')), 'orders.json');
  const room = new Room();
  const a = await new ScoutSeller({ client: room, log: quiet, statePath }).init();
  await order(a); const code = [...a.orders.keys()][0];
  const b = await new ScoutSeller({ client: room, log: quiet, statePath }).init();
  pay(room, 't9', b.orders.get(code).price, code);
  await b.checkPayments();
  assert.equal(b.orders.get(code).status, 'delivered');
});

test('memo "Scout <code>" matches the order, and the word Scout alone is never a code', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  await order(s); const o = [...s.orders.values()][0];
  assert.match(o.code, /^S\d[A-Z0-9]{3}$/);
  assert.match(room.said[0], new RegExp(`--memo "Scout ${o.code}"`));
  pay(room, 't1', o.price, `Scout ${o.code}`);
  await s.checkPayments();
  assert.equal(o.status, 'delivered');
  assert.equal(room.sent.length, 0);
});

test('payment before any order becomes credit, then the next order runs without a second payment', async () => {
  const room = new Room(); const s = await new ScoutSeller({ client: room, log: quiet }).init();
  pay(room, 't1', 8, 'Scout');
  await s.checkPayments();
  assert.equal(room.sent.length, 0, 'not refunded');
  assert.match(room.said.at(-1), /8 cr of Scout credit/);
  await s.handleMessage({ id: 'm2', content: 'scout review https://github.com/a/b', sender_principal_id: 'p_buyer', sender_instance_id: 'i_b' });
  const o = [...s.orders.values()].at(-1);
  assert.equal(o.status, 'delivered');
  assert.equal(s.prepaid.p_buyer, 0);
});

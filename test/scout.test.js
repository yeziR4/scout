import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrder, ScoutSeller } from '../src/arena.js';
import { buildMarket } from '../src/market.js';
import { extractFacts } from '../src/review.js';
import { checkTool } from '../src/probe.js';

test('parseOrder reads services, links and codes', () => {
  assert.deepEqual(parseOrder('scout review https://github.com/a/b.'), { service: 'review', link: 'https://github.com/a/b', code: null });
  assert.equal(parseOrder('@Scout please audit https://x.dev/docs').service, 'review');
  assert.equal(parseOrder('scout menu').service, 'menu');
  assert.equal(parseOrder('scout paid SAB12').code, 'SAB12');
  assert.equal(parseOrder('hello everyone'), null);
  assert.equal(parseOrder('[scout] menu'), null);
});

test('buildMarket finds offers, wants and a median', () => {
  const b = buildMarket([
    { sender: 'alpha', content: 'Selling: code review 10 credits\nTest gen 6 credits' },
    { sender: 'beta', content: 'Offering translation for 4 cr' },
    { sender: 'gamma', content: 'Looking for someone to write docs, will pay 5 credits' },
    { sender: 'delta', content: 'hi all' },
  ]);
  assert.equal(b.stats.offers, 3);
  assert.equal(b.stats.sellers, 2);
  assert.equal(b.wants.length, 1);
  assert.equal(b.wants[0].budget, 5);
  assert.equal(b.stats.median_price, 6);
});

test('extractFacts detects install, MCP config and tools', () => {
  const f = extractFacts('# X\n\nX does a useful thing for agents in every room.\n\n```\nnpx -y x-mcp\n```\n\n"mcpServers": {}\n\nTools: `do_thing`, `other_thing`');
  assert.equal(f.install_command, 'npx -y x-mcp');
  assert.equal(f.has_mcp_config, true);
  assert.deepEqual(f.tool_names, ['do_thing', 'other_thing']);
});

test('checkTool flags weak definitions', () => {
  const t = checkTool({ name: 'DoIt', description: 'does', inputSchema: { properties: { a: {} }, required: ['a', 'b'] } });
  assert.ok(t.issues.length >= 3);
});

class FakeRoom {
  constructor() { this.room = 'rom_test'; this.said = []; this.transfersList = []; }
  me() { return Promise.resolve({ principal: { id: 'p_scout' }, instance: { id: 'i_scout' } }); }
  transfers() { return Promise.resolve({ items: this.transfersList }); }
  say(content, replyTo) { this.said.push({ content, replyTo }); return Promise.resolve({ sequence: 1 }); }
  recent() { return Promise.resolve([{ sender: 'a', content: 'selling x 5 credits', sequence: 1 }]); }
}

test('seller quotes, matches payment by memo, delivers once', async () => {
  const room = new FakeRoom();
  const s = await new ScoutSeller({ client: room, log: () => {} }).init();
  assert.equal(s.payTo, 'p_scout');
  await s.handleMessage({ id: 'msg_1', sequence: 5, content: 'scout market', sender: { name: 'buyer', instance_id: 'i_buyer' } });
  const [o] = [...s.orders.values()];
  assert.equal(o.service, 'market');
  assert.match(room.said[0].content, new RegExp(o.code));
  room.transfersList.push({ id: 'tr_1', amount: o.price, memo: o.code, from: { principal_id: 'p_buyer' }, to: { principal_id: 'p_scout' } });
  await s.checkPayments();
  await s.checkPayments();
  assert.equal(o.status, 'delivered');
  assert.equal(room.said.filter((m) => m.content.includes('delivery for')).length, 1);
  assert.equal(s.earned, o.price);
});

test('seller ignores its own messages and outgoing transfers', async () => {
  const room = new FakeRoom();
  const s = await new ScoutSeller({ client: room, log: () => {} }).init();
  await s.handleMessage({ id: 'msg_2', content: 'scout menu', sender: { instance_id: 'i_scout' } });
  assert.equal(room.said.length, 0);
  room.transfersList.push({ id: 'tr_out', amount: 5, memo: 'x', from: { principal_id: 'p_scout' }, to: { principal_id: 'p_other' } });
  await s.checkPayments();
  assert.equal(s.earned, 0);
});

test('real SharedNet message shape: ids and null name', async () => {
  const { senderIds, senderName } = await import('../src/sharednet.js');
  const m = { id: 'msg_x', sequence: 1, sender_principal_id: 'p_abc', sender_instance_id: 'i_def', sender: { member_id: 'i_def', kind: 'instance', name: null }, content: 'scout menu' };
  assert.deepEqual([...senderIds(m)].sort(), ['i_def', 'p_abc']);
  assert.equal(senderName(m), 'i_def');
});

test('payTo prefers the principal from an instance-shaped whoami', async () => {
  const room = new FakeRoom();
  room.me = () => Promise.resolve({ instance: { id: 'i_1', principal_id: 'p_1' } });
  const s = await new ScoutSeller({ client: room, log: () => {} }).init();
  assert.equal(s.payTo, 'p_1');
});

test('inviter id in whoami is not treated as self', async () => {
  const room = new FakeRoom();
  room.me = () => Promise.resolve({ principal: { id: 'p_me', invited_by_principal_id: 'p_boss' }, instance: { id: 'i_me', principal_id: 'p_me' } });
  const s = await new ScoutSeller({ client: room, log: () => {} }).init();
  await s.handleMessage({ id: 'msg_9', content: 'scout menu', sender_principal_id: 'p_boss', sender_instance_id: 'i_boss' });
  assert.equal(room.said.length, 1);
});

test('another seat of the same account is a customer, own seat is skipped', async () => {
  const room = new FakeRoom();
  room.me = () => Promise.resolve({ principal: { id: 'p_me' }, instance: { id: 'i_seller', principal_id: 'p_me' } });
  const s = await new ScoutSeller({ client: room, log: () => {} }).init();
  await s.handleMessage({ id: 'm1', content: 'scout menu', sender_principal_id: 'p_me', sender_instance_id: 'i_seller' });
  assert.equal(room.said.length, 0);
  await s.handleMessage({ id: 'm2', content: 'scout menu', sender_principal_id: 'p_me', sender_instance_id: 'i_builder' });
  assert.equal(room.said.length, 1);
});

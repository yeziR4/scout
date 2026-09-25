#!/usr/bin/env node
// Scout CLI. Every command prints JSON with --json, a readable summary otherwise.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { reviewProduct, formatReview } from '../src/review.js';
import { probeMcp } from '../src/probe.js';
import { pitchFromLink } from '../src/pitch.js';
import { buildMarket, formatMarket } from '../src/market.js';
import { ScoutSeller, SharedNet, fmtProbe, DEFAULT_PRICES } from '../src/arena.js';
import { startStdio, startHttp } from '../src/mcp.js';

const HELP = `scout: due-diligence desk for agent products

  scout review <link> [--json] [--no-probe]   score a product /100 with ranked fixes
  scout probe <mcp-url> [--json]              live-check a remote MCP server
  scout pitch <link> [--price N] [--json]     agent-readable pitch card
  scout market <messages.json> [--json]       market board from room messages
  scout mcp                                   run the MCP server on stdio
  scout serve [--port 8787]                   run the MCP server over HTTP at /mcp
  scout arena --room rom_... (--invite rit_... | --token sni_...) [--name scout]
                                              run the autonomous seller in a SharedNet room

Env: SCOUT_PRICES='{"review":8,...}' overrides prices.`;

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(`--${name}`);
const out = (summary, data) => console.log(has('json') ? JSON.stringify(data, null, 2) : summary);

async function main() {
  switch (cmd) {
    case 'review': {
      const r = await reviewProduct(need(args[1], 'link'), { probe: !has('no-probe') });
      return out(formatReview(r), r);
    }
    case 'probe': {
      const p = await probeMcp(need(args[1], 'mcp-url'));
      return out(fmtProbe(p), p);
    }
    case 'pitch': {
      const p = await pitchFromLink(need(args[1], 'link'), { price: flag('price') });
      return out(p.card, p);
    }
    case 'market': {
      const src = need(args[1], 'messages.json');
      const msgs = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8'));
      const b = buildMarket(Array.isArray(msgs) ? msgs : msgs.items || []);
      return out(formatMarket(b), b);
    }
    case 'mcp': return startStdio();
    case 'serve': return startHttp(Number(flag('port')) || undefined);
    case 'arena': return arena();
    default: console.log(HELP);
  }
}

async function arena() {
  const room = need(flag('room') || process.env.SHAREDNET_ROOM, '--room');
  const state = '.scout/arena.json';
  const saved = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : {};
  const sn = new SharedNet({ room, token: flag('token') || process.env.SHAREDNET_TOKEN || (saved.room === room ? saved.member_token : undefined) });
  const invite = flag('invite') || process.env.SHAREDNET_INVITE;
  if (!sn.token) {
    need(invite, '--invite (or --token)');
    const j = await sn.join(invite, { name: flag('name') || 'scout', kind: flag('kind') || 'claude-code' });
    mkdirSync('.scout', { recursive: true });
    writeFileSync(state, JSON.stringify({ room, member_token: sn.token }), { mode: 0o600 });
    console.error(`joined ${room} as ${j.member?.id || j.member_id || 'member'}`);
  }
  const prices = { ...DEFAULT_PRICES, ...(process.env.SCOUT_PRICES ? JSON.parse(process.env.SCOUT_PRICES) : {}) };
  await new ScoutSeller({ client: sn, prices }).run({ announce: !has('quiet') });
}

function need(v, name) {
  if (!v) { console.error(`missing ${name}\n\n${HELP}`); process.exit(2); }
  return v;
}

main().catch((e) => { console.error(e.message); process.exit(1); });

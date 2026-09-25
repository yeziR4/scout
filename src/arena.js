// Autonomous Scout seller for a SharedNet room.
// Listens for orders, gives a free preview, takes payment in credits, and delivers in the room.

import { SharedNet, senderName, senderIds, transferInfo } from './sharednet.js';
import { reviewProduct, formatReview } from './review.js';
import { probeMcp } from './probe.js';
import { pitchFromLink } from './pitch.js';
import { buildMarket, formatMarket } from './market.js';

export const DEFAULT_PRICES = { review: 8, pitch: 5, probe: 4, market: 3, kit: 14 };

const TAG = '[scout]';
const URL_RE = /https?:\/\/[^\s<>)"'`]+/i;

export function menu(prices, payTo) {
  return [
    `${TAG} Scout: due diligence for agent products. Free preview on every order, pay only if you want the full result.`,
    `- review <link>: 5-area score /100 + ranked fixes for any product doc/repo/MCP. ${prices.review} cr`,
    `- pitch <link>: agent-readable pitch card for your product. ${prices.pitch} cr`,
    `- probe <mcp-url>: live MCP check, tools, latency, schema issues. ${prices.probe} cr`,
    `- market: who sells what at what price in this room + pricing advice. ${prices.market} cr`,
    `- kit <link>: review + pitch + probe together. ${prices.kit} cr (save ${prices.review + prices.pitch + prices.probe - prices.kit})`,
    `Order: say "scout review https://…". Pay: transfer to ${payTo} with the order code as memo. Delivery is posted here within a minute of payment.`,
  ].join('\n');
}

export function parseOrder(text) {
  const t = String(text || '');
  if (!/\bscout\b/i.test(t) || t.startsWith(TAG)) return null;
  const m = t.match(/\bscout\b[\s,:]*(?:please\s+)?(review|audit|pitch|probe|market|kit|menu|help|prices?|paid)\b/i);
  const service = m ? m[1].toLowerCase() : /\bscout\b/i.test(t) && URL_RE.test(t) ? 'review' : null;
  if (!service) return null;
  const norm = { audit: 'review', help: 'menu', price: 'menu', prices: 'menu' }[service] || service;
  const link = t.match(URL_RE)?.[0]?.replace(/[.,;]+$/, '') || null;
  const code = t.match(/\b(S[A-Z0-9]{4})\b/)?.[1] || null;
  return { service: norm, link, code };
}

export class ScoutSeller {
  constructor({ client, prices = DEFAULT_PRICES, log = console.error, pollMs = 8000 }) {
    this.sn = client;
    this.prices = prices;
    this.log = log;
    this.pollMs = pollMs;
    this.orders = new Map(); // code -> order
    this.seenTransfers = new Set();
    this.myIds = new Set();
    this.earned = 0;
  }

  async init() {
    try {
      const me = await this.sn.me();
      this.me = me;
      // Only our own ids: whoami also carries e.g. invited_by_principal_id, which is someone else.
      for (const v of [me.principal?.id, me.principal_id, me.agent?.id, me.instance?.id, me.instance_id, me.instance?.principal_id]) if (v) this.myIds.add(v);
      this.mySeat = me.instance?.id || me.instance_id || null;
      this.payTo = me.principal?.id || me.principal_id || me.instance?.principal_id || me.instance?.id || me.instance_id || [...this.myIds][0];
    } catch (e) {
      this.log(`whoami failed: ${e.message}`);
    }
    // Remember transfers that happened before we started so they are not matched to new orders.
    try {
      const t = await this.sn.transfers({ limit: 100 });
      for (const it of t.items || []) this.seenTransfers.add(transferInfo(it).id);
    } catch (e) { this.log(`transfers failed: ${e.message}`); }
    return this;
  }

  newCode() {
    let c;
    do { c = 'S' + Math.random().toString(36).slice(2, 6).toUpperCase(); } while (this.orders.has(c));
    return c;
  }

  async handleMessage(m) {
    const content = m.content ?? m.text ?? '';
    if (String(content).startsWith(TAG)) return;
    const ids = senderIds(m);
    // Skip only this seat's own messages: other seats of the same account are real customers.
    const self = this.mySeat ? ids.has(this.mySeat) : [...ids].some((id) => this.myIds.has(id));
    if (self) return;
    const order = parseOrder(content);
    if (!order) return;
    const buyer = senderName(m);
    const msgId = m.id || m.message_id;

    if (order.service === 'menu') return this.sn.say(menu(this.prices, this.payTo), msgId);
    if (order.service === 'paid') return this.checkPayments(true);

    if (['review', 'pitch', 'probe', 'kit'].includes(order.service) && !order.link) {
      return this.sn.say(`${TAG} @${buyer} which link? e.g. "scout ${order.service} https://github.com/you/your-product"`, msgId);
    }
    const code = this.newCode();
    const price = this.prices[order.service];
    const o = { ...order, code, price, buyer, buyerIds: [...ids], msgId, status: 'quoted', at: Date.now() };
    this.orders.set(code, o);

    let preview = '';
    try { preview = await this.preview(o); } catch (e) { preview = `(preview failed: ${e.message})`; }
    await this.sn.say(
      `${TAG} @${buyer} order ${code}: ${o.service}${o.link ? ` ${o.link}` : ''}. ${preview}\n` +
      `Full result: transfer ${price} credits to ${this.payTo} with memo "${code}". I deliver here as soon as it lands.`,
      msgId,
    );
  }

  async preview(o) {
    if (o.service === 'review' || o.service === 'kit') {
      const r = await reviewProduct(o.link);
      o.cache = { review: r };
      return `Preview: score ${r.score}/100 (${r.grade ?? 'F'}). ${r.verdict} ${r.top_fixes?.length || 0} fixes ready.`;
    }
    if (o.service === 'probe') {
      const p = await probeMcp(o.link);
      o.cache = { probe: p };
      return `Preview: ${p.reachable ? `reachable, ${p.tools.length} tools` : 'NOT reachable'}; ${p.issues.length} issues found.`;
    }
    if (o.service === 'pitch') return 'Preview: I will turn your doc into a 5-line card other agents can act on.';
    if (o.service === 'market') {
      const b = buildMarket((await this.sn.recent(100)).map(norm));
      o.cache = { market: b };
      return `Preview: ${b.stats.offers} offers from ${b.stats.sellers} sellers tracked, median ${b.stats.median_price ?? '-'} cr.`;
    }
    return '';
  }

  async deliver(o) {
    let out;
    if (o.service === 'review') out = formatReview(o.cache?.review || await reviewProduct(o.link));
    else if (o.service === 'probe') out = fmtProbe(o.cache?.probe || await probeMcp(o.link));
    else if (o.service === 'pitch') out = (await pitchFromLink(o.link)).card;
    else if (o.service === 'market') out = formatMarket(buildMarket((await this.sn.recent(100)).map(norm)));
    else if (o.service === 'kit') {
      const r = o.cache?.review || await reviewProduct(o.link);
      const p = await pitchFromLink(o.link);
      out = `${formatReview(r)}\n\nPitch card:\n${p.card}${r.live_probe ? `\n\n${fmtProbe(r.live_probe)}` : ''}`;
    }
    await this.sn.say(`${TAG} @${o.buyer} delivery for ${o.code} (paid ${o.paid} cr, thank you):\n${out}`, o.msgId);
    o.status = 'delivered';
    this.log(`delivered ${o.code} ${o.service} to ${o.buyer}`);
  }

  async checkPayments(verbose = false) {
    let items = [];
    try { items = (await this.sn.transfers({ limit: 50 })).items || []; } catch (e) { this.log(`transfers: ${e.message}`); return; }
    for (const raw of items) {
      const t = transferInfo(raw);
      if (!t.id || this.seenTransfers.has(t.id)) continue;
      const incoming = t.direction ? /in|received|credit/i.test(t.direction) : t.to_ids.some((id) => this.myIds.has(id)) || !t.from_ids.some((id) => this.myIds.has(id));
      if (!incoming) { this.seenTransfers.add(t.id); continue; }
      this.seenTransfers.add(t.id);
      this.earned += t.amount;
      const code = (t.memo.match(/S[A-Z0-9]{4}/i) || [])[0]?.toUpperCase();
      let o = code && this.orders.get(code);
      // No memo: match the oldest unpaid order from that payer, else by exact price.
      if (!o) o = [...this.orders.values()].find((x) => x.status === 'quoted' && x.buyerIds.some((id) => t.from_ids.includes(id)));
      if (!o) o = [...this.orders.values()].find((x) => x.status === 'quoted' && x.price === t.amount);
      if (!o) { this.log(`unmatched transfer ${t.id} ${t.amount} memo=${t.memo}`); continue; }
      o.paid = (o.paid || 0) + t.amount;
      if (o.paid >= o.price && o.status === 'quoted') {
        o.status = 'delivering';
        await this.deliver(o).catch((e) => { o.status = 'quoted'; this.log(`deliver ${o.code} failed: ${e.message}`); });
      } else if (verbose) {
        await this.sn.say(`${TAG} ${o.code}: received ${o.paid}/${o.price} cr.`, o.msgId);
      }
    }
  }

  async run({ announce = true, after } = {}) {
    await this.init();
    let last = after;
    if (last === undefined) {
      const recent = await this.sn.recent(1).catch(() => []);
      last = recent.at(-1)?.sequence ?? 0;
    }
    if (announce) await this.sn.say(menu(this.prices, this.payTo));
    this.log(`Scout seller live in ${this.sn.room}, pay-to ${this.payTo}, from seq ${last}`);
    let nextPay = 0;
    let nextBeat = 0;
    for (;;) {
      try {
        const page = await this.sn.wait(last, 20);
        for (const m of page.items || []) {
          last = Math.max(Number(last), Number(m.sequence));
          await this.handleMessage(m).catch((e) => this.log(`handle: ${e.message}`));
        }
      } catch (e) {
        this.log(`wait: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (Date.now() >= nextPay) { await this.checkPayments(); nextPay = Date.now() + this.pollMs; }
      if (this.sn.heartbeat && Date.now() >= nextBeat) { await this.sn.heartbeat().catch(() => {}); nextBeat = Date.now() + 25000; }
    }
  }
}

function norm(m) { return { sender: senderName(m), content: m.content ?? m.text ?? '', sequence: m.sequence }; }

export function fmtProbe(p) {
  const lines = [`MCP probe ${p.url}: ${p.reachable ? 'reachable' : 'NOT reachable'}${p.server ? ` (${p.server.name} ${p.server.version || ''})` : ''}`];
  if (p.latency_ms) lines.push(`latency: ${Object.entries(p.latency_ms).map(([k, v]) => `${k} ${v}ms`).join(', ')}`);
  for (const t of (p.tools || []).slice(0, 12)) lines.push(`- ${t.name}${t.issues.length ? `: ${t.issues.join(', ')}` : ': ok'}`);
  for (const i of p.issues || []) lines.push(`! ${i}`);
  return lines.join('\n');
}

export { SharedNet };

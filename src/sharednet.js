// Minimal SharedNet HTTP client: join, say, wait, read, credits.
// Docs: https://www.sharednet.ai/skill.md and https://www.sharednet.ai/api/docs

import { randomUUID } from 'node:crypto';

export const BASE = process.env.SHAREDNET_BASE || 'https://www.sharednet.ai';

export class SharedNet {
  constructor({ token, room, base = BASE } = {}) {
    this.token = token;
    this.room = room;
    this.base = base;
  }

  async req(method, path, { body, query, token = this.token, idempotent = false, timeoutMs = 35000 } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotent) headers['Idempotency-Key'] = randomUUID();
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`SharedNet ${method} ${path} -> ${res.status}: ${data?.error?.code || ''} ${data?.error?.message || text.slice(0, 200)}`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  // Join with an invite token (rit_...) or instance token (sni_...). Returns the join response.
  async join(inviteToken, { name = 'scout', kind = 'claude-code' } = {}) {
    const data = await this.req('POST', `/api/v1/rooms/${this.room}/join`, {
      token: inviteToken, body: { name, runtime: { kind } },
    });
    if (data.member_token) this.token = data.member_token;
    return data;
  }

  say(content, replyTo) {
    const body = { content: String(content).slice(0, 32000) };
    if (replyTo) body.reply_to_message_id = replyTo;
    return this.req('POST', `/api/v1/rooms/${this.room}/messages`, { body, idempotent: true });
  }

  wait(after, timeout) {
    return this.req('GET', `/api/v1/rooms/${this.room}/wait`, { query: { after, timeout } });
  }

  read(query = {}) {
    return this.req('GET', `/api/v1/rooms/${this.room}/messages`, { query });
  }

  async recent(limit = 100) {
    const page = await this.read({ order: 'desc', limit });
    return (page.items || []).slice().reverse();
  }

  me() { return this.req('GET', '/api/v1/instances/current'); }
  credits() { return this.req('GET', '/api/v1/credits'); }
  transfers(query = {}) { return this.req('GET', '/api/v1/credits/transfers', { query }); }
  transfer(to, amount, memo, roomId = this.room) {
    return this.req('POST', '/api/v1/credits/transfers', { body: { to, amount, memo, room_id: roomId }, idempotent: true });
  }
}

// Message and transfer shapes are read defensively: pick the first field that exists.
export function senderName(m) {
  const s = m.sender || m.author || m.member || {};
  return (typeof s === 'string' ? s : s.name || s.display_name || s.agent_name) || m.sender_name || m.name || 'unknown';
}

export function senderIds(m) {
  const ids = new Set();
  const visit = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /^(p|a|i|mem|rmm|m)_/.test(v) && /sender|author|member|instance|principal|from/i.test(k)) ids.add(v);
      else if (v && typeof v === 'object' && /sender|author|member|from/i.test(k)) visit(v, depth + 1);
    }
  };
  visit(m);
  return ids;
}

export function transferInfo(t) {
  const flat = {};
  const visit = (o, prefix = '') => {
    for (const [k, v] of Object.entries(o || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) visit(v, `${prefix}${k}.`);
      else flat[`${prefix}${k}`] = v;
    }
  };
  visit(t);
  const pick = (re) => Object.entries(flat).filter(([k, v]) => re.test(k) && typeof v === 'string').map(([, v]) => v);
  return {
    id: t.id || t.transfer_id,
    amount: Number(t.amount ?? t.credits ?? 0),
    memo: t.memo || '',
    direction: t.direction || null,
    from_ids: pick(/^(from|sender|payer|source)/i),
    to_ids: pick(/^(to|recipient|payee|destination)/i),
    at: t.created_at || t.at || null,
  };
}

// Probe a remote MCP server over Streamable HTTP (JSON-RPC over POST, JSON or SSE replies).
// Returns the tools it exposes and a quality check of each tool's description and schema.

const PROTOCOL_VERSION = '2025-06-18';

async function rpc(url, body, sessionId, timeoutMs) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - started;
  const sid = res.headers.get('mcp-session-id') || sessionId;
  if (body.id === undefined) return { status: res.status, sessionId: sid, ms };
  const text = await res.text();
  let msg = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        const m = JSON.parse(line.slice(5).trim());
        if (m.id === body.id) { msg = m; break; }
      } catch { /* skip */ }
    }
  } else {
    try { msg = JSON.parse(text); } catch { /* not json */ }
  }
  return { status: res.status, sessionId: sid, ms, msg, raw: msg ? undefined : text.slice(0, 300) };
}

export async function probeMcp(url, { timeoutMs = 15000, smoke = true } = {}) {
  const report = { url, reachable: false, protocol: 'streamable-http', latency_ms: {}, server: null, tools: [], issues: [] };
  try {
    const init = await rpc(url, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scout-probe', version: '0.1.0' } },
    }, null, timeoutMs);
    report.latency_ms.initialize = init.ms;
    report.http_status = init.status;
    if (init.status === 401 || init.status === 403) {
      // The endpoint exists and guards itself: that is a working, authenticated MCP server.
      report.auth_required = true;
      report.issues.push(`initialize needs auth (HTTP ${init.status}); document how to get a key`);
      return report;
    }
    if (!init.msg || init.msg.error) {
      report.not_mcp = !init.msg;
      report.issues.push(`initialize failed (HTTP ${init.status})${init.msg?.error ? `: ${init.msg.error.message}` : init.raw ? `: ${init.raw}` : ''}`);
      return report;
    }
    report.reachable = true;
    report.server = init.msg.result?.serverInfo || null;
    report.instructions = init.msg.result?.instructions || null;
    await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, timeoutMs).catch(() => {});
    const list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, init.sessionId, timeoutMs);
    report.latency_ms.tools_list = list.ms;
    if (!list.msg || list.msg.error) {
      report.issues.push(`tools/list failed (HTTP ${list.status})`);
      return report;
    }
    const rawTools = list.msg.result?.tools || [];
    report.tools = rawTools.map(checkTool);
    if (smoke) report.smoke = await smokeCall(url, init.sessionId, rawTools, timeoutMs);
  } catch (e) {
    report.issues.push(`unreachable: ${e.message}`);
    return report;
  }
  if (!report.tools.length) report.issues.push('server exposes no tools');
  if (report.smoke && !report.smoke.ok) report.issues.push(`real call to \`${report.smoke.tool}\` failed: ${report.smoke.error}`);
  if (!report.instructions) report.issues.push('no server instructions: agents get no overview on connect');
  const slow = Object.entries(report.latency_ms).filter(([, ms]) => ms > 3000);
  for (const [step, ms] of slow) report.issues.push(`${step} took ${ms} ms (>3s feels broken to agents)`);
  return report;
}

export function checkTool(t) {
  const issues = [];
  const desc = (t.description || '').trim();
  const props = t.inputSchema?.properties || {};
  const required = t.inputSchema?.required || [];
  if (!desc) issues.push('missing description');
  else if (desc.length < 40) issues.push('description too short to explain when to use it');
  else if (desc.length > 1200) issues.push('description very long; front-load the first sentence');
  if (!/^[a-z][a-z0-9_-]*$/.test(t.name || '')) issues.push('name is not lower snake_case or kebab-case');
  for (const [k, v] of Object.entries(props)) {
    if (!v.description) issues.push(`param "${k}" has no description`);
  }
  if (required.some((r) => !(r in props))) issues.push('required lists params missing from properties');
  return { name: t.name, description: desc.slice(0, 200), params: Object.keys(props), required, issues };
}

// One real call, only to a tool that is safe to call blind: marked read-only,
// or named like a read (get/list/search/...), with every required arg fillable.
const READ_NAME = /^(get|list|search|read|query|resolve|find|fetch|describe|lookup|health|ping|echo|status|version|whoami|info|menu)|_(menu|info|status|version)$/i;
const WRITE_NAME = /(create|delete|remove|update|write|send|post|push|merge|pay|transfer|buy|order|close|run|exec|click|navigate|type|fill|upload|install)/i;

export function pickSmokeTool(tools) {
  const candidates = tools.filter((t) => {
    const ro = t.annotations?.readOnlyHint === true;
    const destructive = t.annotations?.destructiveHint === true;
    if (destructive || (!ro && (WRITE_NAME.test(t.name) || !READ_NAME.test(t.name)))) return false;
    return sampleArgs(t) !== null;
  });
  // Fewest required args first: the call most likely to work with made-up input.
  return candidates.sort((a, b) => (a.inputSchema?.required?.length || 0) - (b.inputSchema?.required?.length || 0))[0] || null;
}

export function sampleArgs(t) {
  const props = t.inputSchema?.properties || {};
  const args = {};
  for (const k of t.inputSchema?.required || []) {
    const p = props[k] || {};
    const type = Array.isArray(p.type) ? p.type[0] : p.type;
    if (p.enum?.length) args[k] = p.enum[0];
    else if (p.default !== undefined) args[k] = p.default;
    else if (type === 'string') args[k] = p.format === 'uri' || /url|link/i.test(k) ? 'https://example.com' : /query|name|q|term|library|topic/i.test(k) ? 'react' : 'test';
    else if (type === 'number' || type === 'integer') args[k] = p.minimum ?? 1;
    else if (type === 'boolean') args[k] = false;
    else return null;
  }
  return args;
}

async function smokeCall(url, sessionId, tools, timeoutMs) {
  const t = pickSmokeTool(tools);
  if (!t) return { skipped: true, reason: 'no tool is safe to call without real input' };
  const args = sampleArgs(t);
  try {
    const r = await rpc(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: t.name, arguments: args } }, sessionId, timeoutMs);
    const res = r.msg?.result;
    const text = (res?.content || []).map((c) => c.text || '').join(' ').trim();
    const ok = !!res && !res.isError && (text.length > 0 || res.structuredContent !== undefined || (res.content || []).length > 0);
    return { tool: t.name, args, ok, ms: r.ms, error: ok ? undefined : (r.msg?.error?.message || text.slice(0, 160) || `HTTP ${r.status}, empty result`), sample: ok ? text.slice(0, 160) : undefined };
  } catch (e) {
    return { tool: t.name, args, ok: false, error: e.message };
  }
}

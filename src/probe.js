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

export async function probeMcp(url, { timeoutMs = 15000 } = {}) {
  const report = { url, reachable: false, protocol: 'streamable-http', latency_ms: {}, server: null, tools: [], issues: [] };
  try {
    const init = await rpc(url, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scout-probe', version: '0.1.0' } },
    }, null, timeoutMs);
    report.latency_ms.initialize = init.ms;
    if (!init.msg || init.msg.error) {
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
    report.tools = (list.msg.result?.tools || []).map(checkTool);
  } catch (e) {
    report.issues.push(`unreachable: ${e.message}`);
    return report;
  }
  if (!report.tools.length) report.issues.push('server exposes no tools');
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
  if (!/^[a-z][a-z0-9_]*$/.test(t.name || '')) issues.push('name is not snake_case');
  for (const [k, v] of Object.entries(props)) {
    if (!v.description) issues.push(`param "${k}" has no description`);
  }
  if (required.some((r) => !(r in props))) issues.push('required lists params missing from properties');
  return { name: t.name, description: desc.slice(0, 200), params: Object.keys(props), required, issues };
}

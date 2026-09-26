// Due-diligence review of an agent product from its link.
// Scores five areas out of 20 each and returns concrete, ranked fixes.

import { fetchProductDoc } from './fetch.js';
import { probeMcp } from './probe.js';

const INSTALL_RE = /\b(claude[ \t]+mcp[ \t]+add[^\n`]+|codex[ \t]+mcp[ \t]+add[^\n`]+|npx[ \t]+-y[ \t]+[^\s`]+|npx[ \t]+[^\s`-][^\s`]*|npm[ \t]+i(?:nstall)?[ \t]+(?:-g[ \t]+)?[^\s`-][^\s`]*|uv[ \t]+(?:add|tool[ \t]+install|pip[ \t]+install)[ \t]+[^\s`]+|pipx?[ \t]+install[ \t]+(?:-U[ \t]+)?[^\s`]+|python[ \t]+-m[ \t]+pip[ \t]+install[ \t]+(?:-U[ \t]+)?[^\s`]+|uvx[ \t]+[^\s`]+|docker[ \t]+run[ \t]+[^\n`]+|brew[ \t]+install[ \t]+[^\s`]+|go[ \t]+install[ \t]+[^\s`]+|cargo[ \t]+install[ \t]+[^\s`]+|git[ \t]+clone[ \t]+[^\s`]+)/gi;
const MCP_CONFIG_RE = /"mcpServers"|"servers"\s*:|claude\s+mcp\s+add|codex\s+mcp|mcp\.json|\[mcp_servers|"type"\s*:\s*"(?:http|stdio|sse)"/i;
const URL_RE = /https?:\/\/[^\s"'`)<>\]]+/gi;
const CLI_USAGE_RE = /^\s*(\$\s*)?[a-z][\w-]*\s+(--?[a-z]|[a-z][\w-]*\s)/im;
// Hosts and paths that mention MCP but are docs, badges or one-click install redirects, never endpoints.
const NON_ENDPOINT_HOST = /(^|\.)(github\.com|githubusercontent\.com|shields\.io|vscode\.dev|visualstudio\.com|cursor\.com|aka\.ms|npmjs\.com|pypi\.org|goreportcard\.com|lmstudio\.ai|github\.io|localhost|127\.0\.0\.1|0\.0\.0\.0)$/i;

export async function reviewProduct(link, { probe = true } = {}) {
  const doc = await fetchProductDoc(link);
  if (!doc.ok) {
    return {
      link,
      score: 0,
      verdict: 'Link does not load. Agents cannot use a product they cannot read.',
      top_fixes: ['Make the link public and return 200 with the usage instructions on it.'],
      fetch_errors: doc.errors,
    };
  }
  const text = doc.text;
  const facts = extractFacts(text, { name: productName(link) });
  let live = null;
  if (probe && facts.mcp_urls.length) live = await probeCandidates(facts.mcp_urls.slice(0, 2));
  const areas = scoreAreas(text, facts, live);
  const score = areas.reduce((s, a) => s + a.score, 0);
  const fixes = areas.flatMap((a) => a.fixes.map((f) => ({ area: a.area, gap: a.max - a.score, fix: f })))
    .sort((a, b) => b.gap - a.gap)
    .map((f) => `[${f.area}] ${f.fix}`);
  return {
    link,
    source: doc.source,
    kind: facts.kind,
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F',
    verdict: verdict(score, facts, live),
    areas: areas.map(({ area, score: s, max, notes }) => ({ area, score: s, max, notes })),
    top_fixes: fixes.slice(0, 5),
    checked: checkedList(doc, facts, live),
    facts,
    live_probe: live,
  };
}

// Try the best candidates; prefer one that answers, then one that asks for auth.
async function probeCandidates(urls) {
  const results = [];
  for (const u of urls) {
    const r = await probeMcp(u).catch((e) => ({ url: u, reachable: false, issues: [e.message], tools: [] }));
    if (r.reachable) return r;
    results.push(r);
  }
  return results.find((r) => r.auth_required) || results[0];
}

export function productName(link) {
  try {
    const parts = new URL(link).pathname.split('/').filter(Boolean);
    return (parts[1] || parts[0] || '').toLowerCase();
  } catch { return ''; }
}

// Endpoint candidates: path ends in /mcp or /sse (or host is mcp.*), not docs/badges/installers.
// URLs written as a config value ("url": ..., --transport http ...) rank first.
export function endpointCandidates(text) {
  const out = new Map();
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:]+$/, '');
    let u; try { u = new URL(raw); } catch { continue; }
    if (NON_ENDPOINT_HOST.test(u.hostname)) continue;
    if (/\.(svg|png|jpe?g|gif|webp|ico)$/i.test(u.pathname) || /install|badge|deeplink|redirect/i.test(u.pathname + u.search)) continue;
    if (/^docs?\./i.test(u.hostname) || /\/(docs?|guides?|configuration|blog)\//i.test(u.pathname)) continue;
    const endsLikeEndpoint = /\/(mcp|sse)\/?$/i.test(u.pathname) || (/^mcp\./i.test(u.hostname) && /^\/?(mcp\/?)?$/i.test(u.pathname));
    if (!endsLikeEndpoint) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    let rank = 0;
    if (/"(url|serverUrl|endpoint)"\s*:\s*"?$|--transport\s+\S+\s+(\S+\s+)?$|server url\W*$/i.test(before)) rank += 3;
    if (/^mcp\./i.test(u.hostname)) rank += 1;
    if (!/docs?\./i.test(u.hostname)) rank += 1;
    out.set(raw, Math.max(out.get(raw) ?? -1, rank));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

// Pick the install command for this product, not a sibling project mentioned in passing.
export function pickInstall(text, name) {
  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => [m.index, m.index + m[0].length]);
  const inFence = (i) => fences.some(([a, b]) => i >= a && i < b);
  const key = name.replace(/[^a-z0-9]/g, '');
  let best = null;
  for (const m of text.matchAll(INSTALL_RE)) {
    const cmd = m[0].trim();
    const pkg = (cmd.split(/\s+/).pop() || '').toLowerCase().replace(/^@[^/]+\//, '').replace(/@[^@]*$/, '').replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (key && pkg === key) score += 4;
    else if (key && (pkg.includes(key) || cmd.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key))) score += 2;
    if (inFence(m.index)) score += 1;
    if (!best || score > best.score) best = { cmd, score };
  }
  return best?.cmd || null;
}

// Tool names in any common Markdown style: `snake_case`, `kebab-case` or **bold** list/table items.
export function extractToolNames(text) {
  const names = new Set();
  const ident = '([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)';
  for (const m of text.matchAll(new RegExp('`' + ident + '`', 'g'))) if (m[1].includes('_')) names.add(m[1]);
  for (const line of text.split('\n')) {
    if (!/^\s*([-*+]|\d+\.|\|)/.test(line)) continue;
    const lead = line.match(new RegExp('^\\s*(?:[-*+]|\\d+\\.|\\|)\\s*(?:\\*\\*|`)' + ident + '(?:\\*\\*|`)'));
    if (lead) names.add(lead[1]);
  }
  return [...names].filter((n) => !/^(npm|npx|pip|uv|http|https)[-_]/.test(n));
}

export function productKind(text, f) {
  const intro = `${f.first_paragraph} ${f.headings.slice(0, 2).join(' ')}`;
  // Operated by messages and payments in a SharedNet room: no package, no endpoint.
  if (f.room_protocol) return 'room_service';
  if (/\b(framework|library|sdk)\b|\bbuild(ing)? (mcp )?(servers|agents|apps)\b/i.test(intro)) return 'framework';
  if (f.has_mcp_config || f.mcp_urls.length || /\bmcp server\b/i.test(intro)) return 'mcp_server';
  if (/\b(terminal|command[- ]line|cli)\b/i.test(intro) || f.command_lines >= 3) return 'cli';
  return 'service';
}

export function extractFacts(text, { name = '' } = {}) {
  const lines = text.split('\n');
  const headings = lines.filter((l) => /^#{1,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
  const fences = text.match(/```[\s\S]*?```/g) || [];
  const fenceLines = fences.flatMap((b) => b.split('\n').slice(1, -1)).map((l) => l.trim()).filter((l) => l && !/^(#|\/\/)/.test(l));
  const cmdName = name.replace(/-(mcp|cli|server)$/, '').replace(/^mcp-/, '');
  const f = {
    name,
    words: text.split(/\s+/).filter(Boolean).length,
    headings: headings.slice(0, 15),
    code_blocks: fences.length,
    code_lines: fenceLines.length,
    command_lines: fenceLines.filter((l) => (cmdName && l.replace(/^\$\s*/, '').toLowerCase().startsWith(cmdName)) || /^\$\s/.test(l)).length,
    install_command: pickInstall(text, name),
    has_mcp_config: MCP_CONFIG_RE.test(text),
    mcp_urls: endpointCandidates(text),
    has_cli_usage: CLI_USAGE_RE.test(text) || /\busage\b/i.test(text),
    has_flags: (text.match(/(^|\s)--[a-z][\w-]+/g) || []).length >= 3,
    has_code_api: /\bimport\s+\w|from\s+\w+\s+import|require\(|@\w+\.tool\b|def\s+\w+\(|function\s+\w+\(/.test(fences.join('\n')),
    tool_names: extractToolNames(text).slice(0, 20),
    mentions_output_format: /\bjson\b|returns?\b|output/i.test(text),
    mentions_auth: /api[\s_-]?key|token|auth|login|oauth|\bpat\b|free|no key/i.test(text),
    mentions_pricing: /credit|price|cost|\bfree\b|per call/i.test(text),
    mentions_errors: /error|fail|troubleshoot|limit/i.test(text),
    first_paragraph: firstProse(text),
    room_protocol: /\bsharednet\s+(say|pay|upload|join)\b/i.test(text) || (/sharednet/i.test(text) && /\/api\/v1\/(rooms|credits)/i.test(text)),
    room_commands: (text.match(/\bsharednet\s+(say|pay|upload|join|download)\b/gi) || []).length,
    has_payment_steps: /\b(pay|transfer)\b[^\n]{0,80}\b(memo|credits?)\b/i.test(text),
    has_refund_policy: /\brefund/i.test(text),
    no_install_needed: /nothing to install|no install|no signup|no key/i.test(text),
  };
  f.kind = productKind(text, f);
  return f;
}

function firstProse(text) {
  const noCode = text.replace(/```[\s\S]*?```/g, '');
  for (const para of noCode.split(/\n\s*\n/)) {
    const p = para.trim();
    if (p.length < 40) continue;
    if (/^(#|>|<|\||!\[|\[!\[|\[!|-{3}|\*{3})/.test(p)) continue;
    const plain = p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    if (plain.length >= 40) return plain.slice(0, 400);
  }
  return '';
}

function scoreAreas(text, f, live) {
  const areas = [];

  // 1. Clarity: can an agent tell in one read what this is for?
  {
    let s = 0; const fixes = []; const notes = [];
    if (f.first_paragraph.length >= 40) s += 8; else fixes.push('Open with one sentence: what it does, for whom, and the one call to try first.');
    if (f.first_paragraph.length > 0 && f.first_paragraph.length <= 300) s += 4; else if (f.first_paragraph.length > 300) fixes.push('Shorten the opening paragraph; agents skim the first 300 characters.');
    if (f.headings.length >= 3) s += 4; else fixes.push('Add headings (Install, Tools, Examples) so agents can jump to what they need.');
    if (f.words >= 150 && f.words <= 3000) s += 4; else fixes.push(f.words < 150 ? 'Doc is too thin to act on; add usage and examples.' : 'Doc is very long; put a quickstart at the top.');
    notes.push(`${f.words} words, ${f.headings.length} headings`);
    areas.push({ area: 'clarity', score: s, max: 20, notes, fixes });
  }

  // 2. Callability: is there a copy-paste way in? Judged by what the product is.
  {
    let s = 0; const fixes = []; const notes = [`kind: ${f.kind}`];
    if (f.kind === 'room_service') {
      if (f.room_commands >= 2 || f.no_install_needed) { s += 8; notes.push('used through the sharednet CLI/API; no install'); } else fixes.push('Show the exact `sharednet` commands a buyer runs, in order.');
    } else if (f.install_command) { s += 8; notes.push(`install: ${f.install_command}`); } else fixes.push('Add a one-line copy-paste install/run command (e.g. `npx -y <pkg>` or `uv add <pkg>`).');
    if (f.kind === 'room_service') {
      if (/"type"\s*:\s*"[\w.-]+"|\border (format|message)\b|\bsay\b/i.test(text)) s += 7; else fixes.push('Define the order message format (one example message a buyer can copy).');
      if (f.has_payment_steps) s += 5; else fixes.push('Say how to pay: the payee id, amount and memo, e.g. `sharednet pay p_… 5 --memo <order> --room`.');
    } else if (f.kind === 'mcp_server') {
      if (f.has_mcp_config || f.mcp_urls.length) s += 7; else fixes.push('Add an MCP config snippet (`claude mcp add ...` or an `mcpServers` JSON block).');
      if (f.has_cli_usage || f.mcp_urls.length) s += 5; else fixes.push('Show one real launch command.');
    } else if (f.kind === 'framework') {
      if (f.has_code_api) s += 7; else fixes.push('Show a minimal code example that imports it and defines one thing.');
      if (f.command_lines || /\b(run|python|uv run|node)\b/.test(text)) s += 5; else fixes.push('Show the command that runs the example.');
    } else {
      if (f.command_lines || f.has_cli_usage) s += 7; else fixes.push('Show a real command line invoking it.');
      if (f.has_flags || f.has_mcp_config) s += 5; else fixes.push('Document the main flags or options.');
    }
    areas.push({ area: 'callability', score: Math.min(s, 20), max: 20, notes, fixes });
  }

  // 3. Examples: can an agent pattern-match a working call? One rich fence counts like several thin ones.
  {
    let s = 0; const fixes = []; const notes = [`${f.code_blocks} code blocks, ${f.code_lines} code lines`];
    s += Math.min(12, f.code_blocks * 3 + Math.floor(f.code_lines / 2));
    // Real invocations of the product count as worked examples even without the word "example".
    if (/example|e\.g\.|for instance|sample|quick ?start/i.test(text) || f.command_lines >= 2) s += 4; else fixes.push('Add a worked example: input, the exact call, and the output.');
    if (f.mentions_output_format) s += 4; else fixes.push('Show what a call returns (a JSON sample) so agents can parse it.');
    if (f.code_blocks < 1) fixes.push('Add a code block with install and a real call.');
    areas.push({ area: 'examples', score: Math.min(s, 20), max: 20, notes, fixes });
  }

  // 4. Agent-readiness: interface, auth, errors, pricing documented.
  {
    let s = 0; const fixes = []; const notes = [];
    const iface = f.kind === 'room_service' ? f.room_commands > 0 || /"type"\s*:/.test(text)
      : f.kind === 'mcp_server' ? f.tool_names.length > 0
      : f.kind === 'framework' ? f.has_code_api || f.tool_names.length > 0
        : f.has_flags || f.command_lines > 0 || f.tool_names.length > 0;
    if (f.tool_names.length) notes.push(`tools named: ${f.tool_names.slice(0, 8).join(', ')}`);
    if (iface) s += 6; else fixes.push(f.kind === 'mcp_server' ? 'List every tool by name with a one-line purpose.' : 'Document the interface: commands, flags or API calls, one line each.');
    if (f.mentions_auth) s += 5; else fixes.push('State auth up front: key needed or not, and how to get one.');
    if (f.mentions_errors) s += 4; else fixes.push('Document failure modes and limits so agents can recover.');
    if (f.mentions_pricing) s += 5; else fixes.push('State price in credits (or "free") so buying agents can decide instantly.');
    areas.push({ area: 'agent_readiness', score: s, max: 20, notes, fixes });
  }

  // 5. Live check: does the endpoint actually answer? Never blame a product for a URL we guessed wrong.
  {
    let s = 0; const fixes = []; const notes = [];
    const base = f.install_command ? 10 : 4;
    if (!live && f.kind === 'room_service') {
      s = 10 + (f.has_refund_policy ? 4 : 0);
      notes.push('room service: orders run in a SharedNet room, not called by Scout');
      if (!f.has_refund_policy) fixes.push('State a refund policy for failed or unmatched payments; buyers pay blind otherwise.');
    } else if (!live) {
      if (f.kind === 'mcp_server') {
        s = base;
        notes.push('no public MCP endpoint in the doc; installable only');
        fixes.push('Expose a hosted MCP URL (Streamable HTTP) so agents can try it with zero install.');
      } else {
        s = f.install_command ? 14 : 6;
        notes.push(`${f.kind}: no hosted endpoint expected; judged on install path`);
      }
    } else if (live.reachable) {
      s += 10;
      const tools = live.tools || [];
      notes.push(`${tools.length} tools live at ${live.url}`);
      if (tools.length) s += 4;
      const bad = tools.filter((t) => t.issues.length);
      if (tools.length && bad.length === 0) s += 6;
      else if (tools.length) {
        s += Math.round(6 * (1 - bad.length / tools.length));
        for (const t of bad.slice(0, 3)) fixes.push(`Tool \`${t.name}\`: ${t.issues.join(', ')}.`);
      }
      if (live.smoke?.ok) notes.push(`real call to ${live.smoke.tool} returned a result in ${live.smoke.ms} ms`);
      else if (live.smoke && !live.smoke.skipped) { s -= 4; notes.push(`real call to ${live.smoke.tool} failed`); }
      for (const i of live.issues.slice(0, 2)) fixes.push(i);
    } else if (live.auth_required) {
      s = f.mentions_auth ? 16 : 13;
      notes.push(`endpoint ${live.url} answers and requires auth (HTTP ${live.http_status}); tools not listed`);
      if (!f.mentions_auth) fixes.push('Your endpoint requires auth; say how to get a key next to the URL.');
    } else {
      s = Math.max(base - 2, 2);
      notes.push(`endpoint ${live.url} did not answer MCP initialize: ${live.issues.join('; ')}`);
      fixes.push(`The documented endpoint ${live.url} did not answer MCP initialize; check it or label it clearly.`);
    }
    areas.push({ area: 'live_check', score: Math.min(s, 20), max: 20, notes, fixes });
  }
  return areas;
}

// Say exactly what was and was not verified, so nobody reads the score as a correctness guarantee.
function checkedList(doc, f, live) {
  const verified = [`read ${doc.source}`];
  const not = ['whether outputs are correct for real tasks'];
  if (live?.reachable) {
    verified.push(`MCP initialize + tools/list at ${live.url} (${live.tools.length} tools)`);
    if (live.smoke?.ok) verified.push(`one real call: ${live.smoke.tool}(${JSON.stringify(live.smoke.args)}) returned a result`);
    else if (live.smoke?.skipped) not.push('no tool was safe to call blind, so no real call was made');
    else if (live.smoke) verified.push(`one real call: ${live.smoke.tool} FAILED (${live.smoke.error})`);
  } else if (live?.auth_required) {
    verified.push(`endpoint ${live.url} answers and requires auth`);
    not.push('tools behind auth');
  } else if (live) {
    verified.push(`endpoint ${live.url} did not answer MCP initialize`);
  } else if (f.kind === 'room_service') {
    not.push('no order was placed; delivery and refunds not exercised');
  } else {
    not.push('no hosted endpoint to call; install path not executed');
  }
  if (f.install_command && !live?.reachable) not.push(`install command \`${f.install_command}\` not executed`);
  return { verified, not_verified: not };
}

function verdict(score, f, live) {
  const how = f.kind === 'room_service' ? 'room service via the sharednet CLI'
    : live?.reachable ? `live MCP with ${live.tools.length} tools`
    : live?.auth_required ? `live MCP behind auth`
    : f.install_command ? `installable via \`${f.install_command}\``
      : 'no clear way to call it';
  if (score >= 85) return `Strong: an agent can pick this up cold (${how}).`;
  if (score >= 70) return `Good: usable today (${how}); a few doc gaps cost first-try success.`;
  if (score >= 55) return `Workable but rough (${how}); agents will need retries.`;
  return `Hard for an agent to use cold (${how}); fix the top items before the arena.`;
}

export function formatReview(r) {
  const lines = [`Scout review: ${r.link}`, `Score ${r.score}/100 (${r.grade ?? 'F'}). ${r.verdict}`];
  if (r.areas) lines.push(r.areas.map((a) => `${a.area} ${a.score}/${a.max}`).join(' | '));
  if (r.checked) {
    lines.push(`Verified: ${r.checked.verified.join('; ')}.`);
    lines.push(`Not verified: ${r.checked.not_verified.join('; ')}.`);
  }
  if (r.top_fixes?.length) {
    lines.push('Top fixes:');
    r.top_fixes.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
  }
  return lines.join('\n');
}

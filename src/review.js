// Due-diligence review of an agent product from its link.
// Scores five areas out of 20 each and returns concrete, ranked fixes.

import { fetchProductDoc } from './fetch.js';
import { probeMcp } from './probe.js';

const INSTALL_RE = /\b(claude[ \t]+mcp[ \t]+add[^\n`]+|codex[ \t]+mcp[ \t]+add[^\n`]+|npx[ \t]+-y[ \t]+[^\s`]+|npx[ \t]+[^\s`-][^\s`]*|npm[ \t]+i(?:nstall)?[ \t]+(?:-g[ \t]+)?[^\s`-][^\s`]*|pipx?[ \t]+install[ \t]+[^\s`]+|uvx[ \t]+[^\s`]+|docker[ \t]+run[ \t]+[^\n`]+|brew[ \t]+install[ \t]+[^\s`]+|go[ \t]+install[ \t]+[^\s`]+|cargo[ \t]+install[ \t]+[^\s`]+|git[ \t]+clone[ \t]+[^\s`]+)/i;
const MCP_CONFIG_RE = /"mcpServers"|claude\s+mcp\s+add|codex\s+mcp|mcp\.json|\[mcp_servers/i;
const MCP_URL_RE = /https?:\/\/[^\s"'`)<>\]]+\/(mcp|sse)\b[^\s"'`)<>\]]*/gi;
const CLI_USAGE_RE = /^\s*(\$\s*)?[a-z][\w-]*\s+(--?[a-z]|[a-z][\w-]*\s)/im;

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
  const facts = extractFacts(text);
  let live = null;
  if (probe && facts.mcp_urls.length) {
    live = await probeMcp(facts.mcp_urls[0]).catch((e) => ({ reachable: false, issues: [e.message], tools: [] }));
  }
  const areas = scoreAreas(text, facts, live);
  const score = areas.reduce((s, a) => s + a.score, 0);
  const fixes = areas.flatMap((a) => a.fixes.map((f) => ({ area: a.area, gap: a.max - a.score, fix: f })))
    .sort((a, b) => b.gap - a.gap)
    .map((f) => `[${f.area}] ${f.fix}`);
  return {
    link,
    source: doc.source,
    score,
    grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F',
    verdict: verdict(score, facts, live),
    areas: areas.map(({ area, score: s, max, notes }) => ({ area, score: s, max, notes })),
    top_fixes: fixes.slice(0, 5),
    facts,
    live_probe: live,
  };
}

export function extractFacts(text) {
  const lines = text.split('\n');
  const headings = lines.filter((l) => /^#{1,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  const install = text.match(INSTALL_RE)?.[0] || null;
  const mcpUrls = [...new Set((text.match(MCP_URL_RE) || []).map((u) => u.replace(/[.,;]+$/, '')))];
  const firstPara = firstProse(text);
  const toolMentions = [...new Set((text.match(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g) || []).map((s) => s.slice(1, -1)))];
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    headings: headings.slice(0, 15),
    code_blocks: codeBlocks,
    install_command: install,
    has_mcp_config: MCP_CONFIG_RE.test(text),
    mcp_urls: mcpUrls,
    has_cli_usage: CLI_USAGE_RE.test(text) || /\busage\b/i.test(text),
    tool_names: toolMentions.slice(0, 20),
    mentions_output_format: /\bjson\b|returns?\b|output/i.test(text),
    mentions_auth: /api[\s_-]?key|token|auth|login|free|no key/i.test(text),
    mentions_pricing: /credit|price|cost|\bfree\b|per call/i.test(text),
    mentions_errors: /error|fail|troubleshoot|limit/i.test(text),
    first_paragraph: firstPara,
  };
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

  // 2. Callability: is there a copy-paste way in?
  {
    let s = 0; const fixes = []; const notes = [];
    if (f.install_command) { s += 8; notes.push(`install: ${f.install_command}`); } else fixes.push('Add a one-line copy-paste install/run command (e.g. `npx -y <pkg>`).');
    if (f.has_mcp_config || f.mcp_urls.length) s += 7; else fixes.push('Add an MCP config snippet (`claude mcp add ...` or an `mcpServers` JSON block).');
    if (f.has_cli_usage) s += 5; else fixes.push('Show CLI usage with a real command line.');
    areas.push({ area: 'callability', score: Math.min(s, 20), max: 20, notes, fixes });
  }

  // 3. Examples: can an agent pattern-match a working call?
  {
    let s = 0; const fixes = []; const notes = [`${f.code_blocks} code blocks`];
    s += Math.min(f.code_blocks, 4) * 3;
    if (/example|e\.g\.|for instance|sample/i.test(text)) s += 4; else fixes.push('Add a worked example: input, the exact call, and the output.');
    if (f.mentions_output_format) s += 4; else fixes.push('Show what a call returns (a JSON sample) so agents can parse it.');
    if (f.code_blocks < 2) fixes.push('Add at least two code blocks: install and a real call.');
    areas.push({ area: 'examples', score: Math.min(s, 20), max: 20, notes, fixes });
  }

  // 4. Agent-readiness: tools, auth, errors, pricing documented.
  {
    let s = 0; const fixes = []; const notes = [];
    if (f.tool_names.length) { s += 6; notes.push(`tools named: ${f.tool_names.slice(0, 8).join(', ')}`); } else fixes.push('List every tool/command by name with a one-line purpose.');
    if (f.mentions_auth) s += 5; else fixes.push('State auth up front: key needed or not, and how to get one.');
    if (f.mentions_errors) s += 4; else fixes.push('Document failure modes and limits so agents can recover.');
    if (f.mentions_pricing) s += 5; else fixes.push('State price in credits (or "free") so buying agents can decide instantly.');
    areas.push({ area: 'agent_readiness', score: s, max: 20, notes, fixes });
  }

  // 5. Live check: does the endpoint actually answer?
  {
    let s = 0; const fixes = []; const notes = [];
    if (!live) {
      s = f.install_command ? 10 : 4;
      notes.push('no public MCP URL found; not probed');
      fixes.push('Expose a hosted MCP URL (Streamable HTTP) so agents can try it with zero install.');
    } else if (!live.reachable) {
      notes.push(`MCP URL did not answer: ${live.issues.join('; ')}`);
      fixes.push('Your documented MCP URL does not answer initialize; fix it before the arena.');
    } else {
      s += 10;
      const tools = live.tools || [];
      notes.push(`${tools.length} tools live`);
      if (tools.length) s += 4;
      const bad = tools.filter((t) => t.issues.length);
      if (tools.length && bad.length === 0) s += 6;
      else if (tools.length) {
        s += Math.round(6 * (1 - bad.length / tools.length));
        for (const t of bad.slice(0, 3)) fixes.push(`Tool \`${t.name}\`: ${t.issues.join(', ')}.`);
      }
      for (const i of live.issues.slice(0, 2)) fixes.push(i);
    }
    areas.push({ area: 'live_check', score: Math.min(s, 20), max: 20, notes, fixes });
  }
  return areas;
}

function verdict(score, f, live) {
  const how = live?.reachable ? `live MCP with ${live.tools.length} tools`
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
  if (r.top_fixes?.length) {
    lines.push('Top fixes:');
    r.top_fixes.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
  }
  return lines.join('\n');
}

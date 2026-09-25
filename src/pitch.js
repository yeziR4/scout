// Build an agent-readable pitch card from a product link (or raw fields).
// Output is short on purpose: one line, a try-it call, tools, and price.

import { reviewProduct } from './review.js';

export async function pitchFromLink(link, { price } = {}) {
  const r = await reviewProduct(link, { probe: true });
  const f = r.facts || {};
  const tools = r.live_probe?.tools?.length ? r.live_probe.tools.map((t) => t.name) : f.tool_names || [];
  const name = guessName(link, f);
  return pitchCard({
    name,
    one_liner: f.first_paragraph || '(no summary found; write one)',
    try_it: f.install_command || r.live_probe?.url || link,
    tools,
    price,
    link,
    score: r.score,
  });
}

export function pitchCard({ name, one_liner, try_it, tools = [], price, link, score }) {
  const oneLine = String(one_liner).replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].slice(0, 180);
  const lines = [
    `**${name}**: ${oneLine}`,
    `Try it: \`${try_it}\``,
  ];
  if (tools.length) lines.push(`Tools: ${tools.slice(0, 8).map((t) => `\`${t}\``).join(', ')}`);
  if (price !== undefined && price !== null && price !== '') lines.push(`Price: ${price} credits`);
  if (link) lines.push(`Docs: ${link}`);
  const card = lines.join('\n');
  return {
    card,
    chars: card.length,
    notes: [
      score !== undefined ? `Doc score ${score}/100; run review_product for fixes.` : null,
      card.length > 600 ? 'Card is long; trim the one-liner.' : null,
    ].filter(Boolean),
  };
}

function guessName(link, f) {
  const h = f.headings?.[0];
  if (h && h.length < 40) return h;
  try {
    const u = new URL(link);
    const parts = u.pathname.split('/').filter(Boolean);
    return u.hostname === 'github.com' && parts[1] ? parts[1] : u.hostname;
  } catch { return link; }
}

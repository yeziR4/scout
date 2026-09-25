// Read a room's messages and turn them into a market board:
// who sells what at what price, who is asking for what, and a price suggestion.

const PRICE_RE = /(\d{1,4})\s*(?:arena\s*)?(?:credits?|cr\b|pts?\b|points?)/i;
const OFFER_RE = /\b(sell|selling|offer|offering|service|for sale|i can|we can|available|menu|catalog|price list|buy my|order)\b/i;
const WANT_RE = /\b(looking for|need|want to buy|wtb|anyone (?:selling|offer)|will pay|buying|request)\b/i;

export function buildMarket(messages) {
  const offers = [];
  const wants = [];
  for (const m of messages) {
    const content = String(m.content || '');
    const who = m.sender || m.sender_name || m.author || m.from || 'unknown';
    // Catalog messages often list several priced lines; take each one.
    const pricedLines = content.split('\n').filter((l) => PRICE_RE.test(l));
    const isWant = WANT_RE.test(content) && !OFFER_RE.test(content.split('\n')[0]);
    if (isWant) {
      const price = content.match(PRICE_RE);
      wants.push({ who, sequence: m.sequence, budget: price ? Number(price[1]) : null, text: firstLine(content) });
      continue;
    }
    if (pricedLines.length && (OFFER_RE.test(content) || pricedLines.length > 1)) {
      for (const line of pricedLines.slice(0, 8)) {
        offers.push({ who, sequence: m.sequence, price: Number(line.match(PRICE_RE)[1]), service: clean(line) });
      }
    }
  }
  const prices = offers.map((o) => o.price).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  return {
    offers: offers.sort((a, b) => a.price - b.price),
    wants,
    stats: {
      offers: offers.length,
      sellers: new Set(offers.map((o) => o.who)).size,
      buyers_asking: wants.length,
      min_price: prices[0] ?? null,
      median_price: median,
      max_price: prices.at(-1) ?? null,
    },
    advice: advice(prices, median, wants),
  };
}

function advice(prices, median, wants) {
  const out = [];
  if (!prices.length) out.push('No priced offers yet: post a clear menu with prices now and set the market anchor.');
  else {
    out.push(`Median ask is ${median} credits. Price a quick, concrete deliverable just under it (${Math.max(1, median - 1)}) to win volume.`);
    if (prices.length >= 3) out.push(`Premium tier: a bundle at ~${Math.round(median * 1.8)} credits works if it saves the buyer several separate purchases.`);
  }
  if (wants.length) out.push(`${wants.length} open request(s) in the room: answer them directly with a quote; unmet demand is the fastest sale.`);
  out.push('Deliver before or right after payment and post the result in the room: visible delivery sells the next order.');
  return out;
}

function firstLine(s) { return clean(s.split('\n').find((l) => l.trim()) || ''); }
function clean(s) { return s.replace(/^[\s>*\-•\d.)]+/, '').replace(/\s+/g, ' ').trim().slice(0, 160); }

export function formatMarket(b) {
  const lines = [`Market: ${b.stats.offers} offers from ${b.stats.sellers} sellers, ${b.stats.buyers_asking} open requests. Median ${b.stats.median_price ?? '-'} cr.`];
  for (const o of b.offers.slice(0, 15)) lines.push(`- ${o.price} cr | ${o.who} | ${o.service}`);
  if (b.wants.length) {
    lines.push('Requests:');
    for (const w of b.wants.slice(0, 10)) lines.push(`- ${w.who}${w.budget ? ` (budget ${w.budget})` : ''}: ${w.text}`);
  }
  lines.push('Advice:', ...b.advice.map((a) => `- ${a}`));
  return lines.join('\n');
}

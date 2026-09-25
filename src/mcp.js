// Scout MCP server. stdio by default; `serve` exposes the same tools over Streamable HTTP.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { reviewProduct, formatReview } from './review.js';
import { probeMcp } from './probe.js';
import { pitchFromLink, pitchCard } from './pitch.js';
import { buildMarket, formatMarket } from './market.js';
import { fmtProbe, menu, DEFAULT_PRICES } from './arena.js';

const INSTRUCTIONS = `Scout is a due-diligence desk for agent products.
Start with review_product on any product link (GitHub repo, docs page, README) to get a score /100 and ranked fixes.
Use probe_mcp on a remote MCP URL to see if it answers and how good its tool definitions are.
Use pitch_card to turn a product into a short card other agents can act on.
Use market_board with pasted room messages to see who sells what at what price.
All tools are free here and need no key; results are JSON with a human summary.`;

const text = (summary, data) => ({ content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }] });

export function buildServer() {
  const server = new McpServer({ name: 'scout', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('review_product', {
    title: 'Review an agent product',
    description: 'Due-diligence review of any agent product from its link (GitHub repo, README, docs page). Scores clarity, callability, examples, agent-readiness and a live MCP check out of 100, and returns ranked, concrete fixes. Use it before presenting your own product or when asked to critique someone else\'s.',
    inputSchema: {
      link: z.string().url().describe('Product link: GitHub repo URL, raw README, or docs page URL.'),
      probe: z.boolean().optional().describe('Also probe any MCP URL found in the doc (default true).'),
    },
  }, async ({ link, probe = true }) => {
    const r = await reviewProduct(link, { probe });
    return text(formatReview(r), r);
  });

  server.registerTool('probe_mcp', {
    title: 'Probe a remote MCP server',
    description: 'Connects to a remote MCP server over Streamable HTTP, runs initialize and tools/list, and reports reachability, latency, server info, and per-tool issues (missing descriptions, undocumented params, bad names). Use it to check an MCP endpoint works before relying on it.',
    inputSchema: { url: z.string().url().describe('The MCP endpoint URL, usually ending in /mcp.') },
  }, async ({ url }) => {
    const p = await probeMcp(url);
    return text(fmtProbe(p), p);
  });

  server.registerTool('pitch_card', {
    title: 'Write an agent-readable pitch',
    description: 'Builds a short pitch card (one-liner, try-it command, tools, price, docs link) that another agent can act on in one read. Give a link to derive it from the product doc, or pass the fields directly.',
    inputSchema: {
      link: z.string().url().optional().describe('Product link to derive the card from.'),
      name: z.string().optional().describe('Product name, when not using a link.'),
      one_liner: z.string().optional().describe('What it does, one sentence, when not using a link.'),
      try_it: z.string().optional().describe('The exact command or URL to try it.'),
      tools: z.array(z.string()).optional().describe('Tool or command names.'),
      price: z.number().int().optional().describe('Price in credits to show on the card.'),
    },
  }, async (a) => {
    const p = a.link ? await pitchFromLink(a.link, { price: a.price }) : pitchCard(a);
    return text(p.card, p);
  });

  server.registerTool('market_board', {
    title: 'Read a room market',
    description: 'Turns chat messages from a trading room into a market board: priced offers sorted by price, open buy requests, median price, and pricing advice. Pass the messages you have read from the room.',
    inputSchema: {
      messages: z.array(z.object({
        sender: z.string().describe('Who posted it.'),
        content: z.string().describe('Message text.'),
        sequence: z.number().optional().describe('Room sequence number, if known.'),
      })).describe('Room messages, oldest first.'),
    },
  }, async ({ messages }) => {
    const b = buildMarket(messages);
    return text(formatMarket(b), b);
  });

  server.registerTool('scout_menu', {
    title: 'Scout services and prices',
    description: 'Returns the paid services Scout\'s own arena agent sells in SharedNet rooms, with credit prices and how to order.',
    inputSchema: { pay_to: z.string().optional().describe('Principal id to show as the payee.') },
  }, async ({ pay_to }) => text(menu(DEFAULT_PRICES, pay_to || '<scout principal id>'), DEFAULT_PRICES));

  return server;
}

export async function startStdio() {
  await buildServer().connect(new StdioServerTransport());
}

export function startHttp(port = Number(process.env.PORT) || 8787) {
  const landing = (() => {
    try { return readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8'); } catch { return 'Scout MCP. POST /mcp'; }
  })();
  const http = createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/agents.md') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(landing);
    }
    if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    if (!req.url.startsWith('/mcp')) { res.writeHead(404); return res.end('not found'); }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }));
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed; try { parsed = JSON.parse(body); } catch { parsed = undefined; }
    // Stateless: a fresh server + transport per request.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  http.listen(port, () => console.error(`Scout MCP on http://localhost:${port}/mcp`));
  return http;
}

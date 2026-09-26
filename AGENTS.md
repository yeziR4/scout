# Scout

Scout reviews any agent product from its link: a score out of 100, ranked fixes, a live MCP check and a pitch card. Free MCP server and CLI, no key.

**Try it now (no key, no signup):**

- Hosted MCP (Streamable HTTP): `https://scout-production-8708.up.railway.app/mcp`
- CLI: `npx -y github:yeziR4/scout review https://github.com/owner/some-agent-product`

```bash
claude mcp add --transport http scout https://scout-production-8708.up.railway.app/mcp
```

## Install as an MCP server

Claude Code:

```bash
claude mcp add scout -- npx -y github:yeziR4/scout mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.scout]
command = "npx"
args = ["-y", "github:yeziR4/scout", "mcp"]
```

Any client (`mcpServers` JSON):

```json
{ "mcpServers": { "scout": { "command": "npx", "args": ["-y", "github:yeziR4/scout", "mcp"] } } }
```

Self-host over HTTP: `npx -y github:yeziR4/scout serve --port 8787`, then connect to `http://<host>:8787/mcp` (Streamable HTTP, stateless).

## Tools

| Tool | What it does | Key input |
| --- | --- | --- |
| `review_product` | Scores clarity, callability, examples, agent-readiness and a live check (each /20) and returns ranked fixes | `link` |
| `probe_mcp` | Runs `initialize` + `tools/list` on a remote MCP URL; reports reachability, latency and per-tool issues | `url` |
| `pitch_card` | Five-line agent-readable pitch: one-liner, try-it command, tools, price, docs | `link` or fields |
| `market_board` | Turns room messages into priced offers, open requests, median price and pricing advice | `messages[]` |
| `scout_menu` | Scout's paid services and prices in SharedNet rooms | none |

Every tool returns a readable summary followed by the full JSON.

## CLI

```bash
scout review <link> [--json] [--no-probe]
scout probe <mcp-url> [--json]
scout pitch <link> [--price 5] [--json]
scout market messages.json [--json]        # [{sender, content, sequence}]
scout mcp                                  # MCP on stdio
scout serve --port 8787                    # MCP over HTTP at /mcp
scout arena --room rom_… --invite rit_…    # autonomous seller in a SharedNet room
```

Example output of `scout review`:

```text
Scout review: https://github.com/Webeleven/collab-mcp
Score 85/100 (A). Strong: an agent can pick this up cold (installable via `git clone ...`).
clarity 20/20 | callability 20/20 | examples 20/20 | agent_readiness 15/20 | live_check 10/20
Top fixes:
1. [live_check] Expose a hosted MCP URL (Streamable HTTP) so agents can try it with zero install.
2. [agent_readiness] State price in credits (or "free") so buying agents can decide instantly.
```

## Buying from Scout in a SharedNet room

Say one of these in the room; Scout replies with an order code and a **free preview**:

| Say | You get | Price |
| --- | --- | --- |
| `scout review <link>` | full score breakdown + top 5 fixes | 8 credits |
| `scout pitch <link>` | pitch card for your product | 5 credits |
| `scout probe <mcp-url>` | live MCP health + tool issues | 4 credits |
| `scout market` | room price board + pricing advice | 3 credits |
| `scout kit <link>` | review + pitch + probe | 14 credits |
| `scout menu` | this list | free |

Pay with the standard SharedNet CLI, using the order code from the quote as the memo:

```bash
sharednet pay <scout id from the quote> 8 --memo SAB12 --room
```

(or `POST /api/v1/credits/transfers` `{"to":"<scout id>","amount":8,"memo":"SAB12","room_id":"rom_…"}`). Scout watches its ledger and posts the delivery in the room, replying to your order.

**Refunds are automatic:** a delivery that fails twice is refunded in full; overpayment is delivered and the excess refunded; a payment whose memo names an unknown or already-served order code is refunded. Free previews are limited to 3 per buyer per 10 minutes; paid orders are never limited.

## What a score means

Every review prints what was **verified** (the doc read, MCP `initialize` + `tools/list`, one real call to a read-only tool and its result) and what was **not verified** (always including whether outputs are correct for real tasks). The score estimates how likely an agent is to get a first call working; it is not a correctness test. Scout only ever calls tools marked read-only or named like reads (`get_`, `list_`, `search_`…), never anything that writes.

## Auth, limits, errors

- No API key. The MCP server and CLI only fetch the public link you give them.
- Reviews read the README (GitHub repos) or the page text; private links fail with the HTTP status in `fetch_errors`.
- Probes time out after 15 s; slow steps (>3 s) are reported as issues.
- The arena seller needs a SharedNet invite (`rit_…`) or instance token (`sni_…`); tokens stay in `.scout/`, never in the room.

## How it was built

Built during Trial Zero by agents collaborating in a SharedNet room: see `COLLAB.md`.

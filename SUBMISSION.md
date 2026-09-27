# Trial Zero submission: Scout

**Project name:** Scout
**Participant / contact:** H (yezir4), hassanyezir2002@gmail.com
**Team:** solo human with two agents (Claude Code, Codex)

## Product link and how to call it

**Link:** https://github.com/yeziR4/scout (README = agent instructions)

Scout reviews any agent product from its link: a score out of 100, ranked fixes, one real call to its live endpoint, and a clear list of what was and was not verified.

- **MCP (hosted, no key):** `https://scout-production-8708.up.railway.app/mcp` (Streamable HTTP). Tools: `review_product`, `probe_mcp`, `pitch_card`, `market_board`, `scout_menu`.
  `claude mcp add --transport http scout https://scout-production-8708.up.railway.app/mcp`
- **CLI:** `npx -y github:yeziR4/scout review <link>` (also `probe`, `pitch`, `market`, `mcp`, `serve`, `arena`)
- **In a SharedNet room:** say `scout check <link>`; free preview first, pay with `sharednet pay <id> <n> --memo "Scout <code>" --room`, delivery posted in the room.

**Prices (Arena credits):** MCP/CLI tools free · `check` 3 · `market` 3 · `probe` 4 · `pitch` 5 · `review` 8 · `kit` 14. Free preview on every order; automatic refund if delivery fails; paying before ordering is kept as credit, not bounced.

**Speed:** a review runs in 1–4 s (measured on Context7, Maiyesh, Playwright MCP); room orders are delivered within a minute of payment.

**Sample MCP call:**

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"review_product","arguments":{"link":"https://github.com/upstash/context7"}}}
```

POST it to `https://scout-production-8708.up.railway.app/mcp` with `Accept: application/json, text/event-stream`. Returns a score, five sub-scores, ranked fixes, and Verified / Not verified lines.

## SharedNet room ID

**`rom_vpkkJ8KYuw`**

## How the agents worked together

Claude Code and Codex worked in one SharedNet room using `[TODO]` → `[CLAIM]` → `[HANDOFF]` → `[RESULT]` → `[REVIEW]`/`[MERGED]` messages. Claude Code built and deployed Scout and reviewed every change; Codex wrote tests, independently scored five real products to calibrate Scout (finding four root causes of wrong scores, all fixed), and named the weakest point a judge would attack, which became a feature: a real call plus a Verified / Not verified report on every review. Each agent caught bugs in the other's work before merge, and together they ran pilots with two other Trial Zero teams: FieldTrace fixed the friction point Scout's pilot found within an hour (cited in their own submission), and Scout flagged Maiyesh's temporary preview URL. Full log: `COLLAB.md`.

# Scout arena playbook

For Scout's agent in the Trial Zero arena room. Humans are away; follow this.

## Start (at the arena room invite)

```bash
# In the scout repo, logged in with `npx -y sharednet@latest login` (credits go to the account)
node bin/scout.js arena --room <rom_…> --invite <rit_…> --quiet   # seller, runs in the background
```

The seller answers `scout …` orders by itself. You (the agent) handle conversation, Round 1 and anything the seller does not.

## Round 1: present, try others, critique

### Pitch (post once, early)

> **Scout**: give it any agent product link, get a score /100, the top 3 fixes, and one real call to the live endpoint. Free, no key.
> Try it: `claude mcp add --transport http scout https://scout-production-8708.up.railway.app/mcp`, then `review_product {"link": "<your repo>"}`
> Or CLI: `npx -y github:yeziR4/scout review <link>`
> Every review says what was verified and what was not.

### Demo: review the other products, publicly and for free

For each product presented:
1. Run `review_product` on its link.
2. Post: one real strength, the score, the **top 3 fixes**, and the "Verified / Not verified" lines.
3. Try one of their tools yourself when it is safe (read-only) and say what happened.

Be fair and specific. Never call a product broken unless Scout's real call failed; say "could not verify" otherwise.

### Answers to the likely questions

**"What three fixes would help agents try and buy my product?"**
Run `review_product` on their link and give its top 3 fixes, in order. They are ranked by how many points each area is missing.

**"Why pay when Scout's MCP and CLI are free?"**
The tools are free and stay free. Paying in the room buys: it is done now with zero setup, the result is posted publicly in the room as third-party evidence buyers and judges can see, and it bundles review + pitch card + live check in one order. The preview is always free, so nobody pays blind.

**"What did Scout actually verify?"**
Exactly what the "Verified" line says: the doc it read, whether the endpoint answered MCP `initialize` and `tools/list`, and one real call to a read-only tool with its result. The "Not verified" line says the rest, always including whether outputs are correct for real tasks.

### The weakest point, stated before a judge does

"A good score doesn't prove a product works." Agreed, and Scout says so on every review. It measures how likely an agent is to *get a first call working*, and it makes one real call to check. We calibrated it against five real products (Playwright MCP, GitHub MCP Server, Context7, FastMCP, Aider) with a second agent's independent scoring, and fixed every false failure it found. It is a due-diligence first pass, not a correctness test.

## Round 2: trade

- **Sell** (the seller runs this): review 8, pitch 5, probe 4, market 3, kit 14 credits. A free preview on every order.
- **Price check**: after ~10 minutes, run `scout market` on the room (or `market_board`). If the median ask is below our price, lower review to median − 1 with `SCOUT_PRICES` and restart the seller with `--token` (keeps the seat).
- **Answer requests**: when anyone asks for feedback, testing, a pitch or pricing help, quote the matching Scout service in one line.
- **Deliver or refund**: if a paid delivery fails, retry once; if it fails again, transfer the credits back with memo `refund <code>`.
- **Buy** (up to 30 of our 100 credits): only services we can use right away, like a review of Scout by another agent, or a translation of our pitch. Prefer sellers who bought from us. Never buy just to raise someone's count.
- Never pay first for an order above 10 credits without a preview or a delivery record from that seller.

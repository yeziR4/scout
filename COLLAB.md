# How Scout was built: agent collaboration log

Scout was built in one SharedNet room, **`rom_vpkkJ8KYuw`** ("Trial Zero - Scout build"), by two agents with one human coordinating:

- **claude-code** (Claude Code): architect and builder, reviewer and merger of Codex's work, deploys and live tests.
- **Codex**: test author, adversarial reviewer of the scoring, arena-question analyst, cross-team pilot runner.
- **scout-seller**: Scout's own seller, joined to the room for live order tests.

Every task went through the room with the same markers: `[TODO]` → `[CLAIM]` → `[HANDOFF]` (context to start cold) → `[RESULT]` (commit sha + evidence) → `[REVIEW]` / `[MERGED]`. Message numbers below are room sequence numbers.

## Timeline

| # | Who | What happened |
| --- | --- | --- |
| 1 | claude-code | `[DECISION]` product and architecture; `[TODO]` list of 5 open tasks for any agent to claim |
| 2–7 | claude-code + seller | First live seller test in the room. It exposed 3 real bugs (seller ignored orders, earnings went to an anonymous purse, a 422 on join); fixed and reported in #7 |
| 8–9 | Codex → claude-code | Codex claims task 2 (market-parser tests); claude-code hands off the API, test conventions, 5 edge cases and a branch to push to |
| 10–11 | claude-code | Claims and completes task 3: Scout hosted on Railway, verified from outside with Scout's own probe |
| 12 | Codex | `[RESULT]`: 12 tests, 4 parser fixes on `codex/market-tests` |
| 13 | claude-code | `[REVIEW]`: reproduces 2 regressions in Codex's fixes (free previews priced at 0, URLs with `?` dropping offers), asks for a fix + test each |
| 14–15 | Codex → claude-code | Codex fixes both; claude-code re-runs the repro cases and merges (`8e84c90`) |
| 16–17 | Codex | Task 1: runs Scout on 5 real products (Playwright MCP, GitHub MCP Server, Context7, FastMCP, Aider), scores each independently, finds 4 root causes of wrong scores |
| 18 | claude-code | Fixes all 4 (endpoint classification, tool-name parsing, install scoping, kind-aware rubric); scores move from 58–76 to 83–94, within a few points of Codex's |
| 19 | Codex | Arena prep: the 3 questions other agents will ask, and the weakest point a judge would attack ("the score doesn't prove the product works") |
| 20 | claude-code | Answers the weakest point in the product: one real call to a safe read-only tool, plus a Verified / Not verified section on every review |
| 21–23 | claude-code | Studies another team's published service doc (FieldTrace); Scout had misjudged room services, so adds a `room_service` kind and adopts their refund and preview-limit practices |
| 24 | Codex + claude-code | Cross-team pilot: claude-code prepares the request, Codex runs FieldTrace's free preflight in their room (convertible, 4 changes); both teams improved their docs from it |
| 25 | claude-code | Scout run on another team's live MCP (Maiyesh): real call OK, 7 undocumented params, a temporary preview URL on their page; 3 Scout bugs found and fixed |
| 26 | claude-code | `[DECISION]`: arena rules from the organisers + lessons from the previous hackathon's public Arena 2 log, built into the seller and the playbook |

## What the collaboration changed

- **Codex's tests caught real bugs**, and **claude-code's review caught regressions in Codex's fixes**: each agent checked the other's work before merge.
- **Codex's independent scoring was Scout's calibration set.** Without it, Scout would have told Playwright's and GitHub's teams their products were broken.
- **Codex's "weakest point" became a feature** (the real call and the Verified / Not verified lines), not just a talking point.
- **Work crossed team boundaries**: two other Trial Zero teams' products were tested, and feedback went both ways.

## Numbers

- 26 room messages, 2 agents plus the seller, 1 human coordinator
- 7 tasks claimed and closed through the room
- 42 automated tests; every agent-found bug has a regression test
- Hosted MCP verified from outside after every deploy: `https://scout-production-8708.up.railway.app/mcp`

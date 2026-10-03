# RedCell — advanced AI attacker agent

RedCell is the **pro** evolution of the Week-3 attacker agent. Week 3 showed you the loop in ~700 lines with one
LLM and a static ladder. RedCell is a **multi-agent red-team campaign engine** you could point at a real
(authorized) target: it runs the full AI-audit lifecycle, has a real strategy matrix, a rich terminal that shows
**every step**, and an **HTML control dashboard**. Same philosophy as the EnGenious AI Audit Service: *scripts
own the math and the verdicts; models propose wording and prose.*

> **Authorized lab use only.** Ships pointed at your own MerciBank on `localhost`. See `rules-of-engagement.md`.

## The lifecycle (every stage has a deterministic path + an optional "brain")

```
WAKE → ORIENT → PLAN → ATTACK → JUDGE → REINFORCE   (campaign loop)
                         then → VERIFY → SCORE → PROMOTE → REPORT   (close the loop)
```

| Stage | Code (always runs) | Brain (optional LLM/sub-agent) |
|---|---|---|
| WAKE | health + ROE gate, load memory | summarize the target |
| ORIENT | probe envelope/tools/refusals | fingerprint → re-weight the matrix |
| PLAN | UCB bandit picks objective×family | strategist picks technique + framing |
| ATTACK | converter chain + orchestrator | writes the next message when refused |
| JUDGE | canary/flag verdict (authoritative) | rubric second opinion |
| REINFORCE | update bandit + memory | writes a lesson from the miss |
| VERIFY | reproduce 3× parallel + gate | baseline: is it *agentic*? |
| SCORE | AIVSS vector + score | explains the vector |
| PROMOTE | promptfoo regression + red-team config | — |
| REPORT | assemble facts + fix | dev + stakeholder prose |

No keys? It still runs — deterministic ladders + templated prose + the in-process mock target. Add a model and
each stage gets smarter.

## Quickstart

```bash
cp .env.example .env          # optional; it runs without keys

# 1) Offline demo — no key, no network, in-process vulnerable target:
npm run demo                  # = node attack.mjs --adapter mock
node verify.mjs --adapter mock
node report.mjs

# 2) Against your real Week-2 MerciBank (recommended: add an attacker model in .env):
#    terminal 1:  cd ../week2-mercibank && npm start
#    terminal 2:
npm start                     # = node attack.mjs   (adapter mercibank, localhost:8080)
npm run verify
npm run report

# 3) The dashboard (control room):
npm run dashboard             # → http://localhost:8787
```

Zero npm dependencies. Node 18+.

## The strategy matrix (the "big set of attacks")

Breadth comes from **composition**, not a payload dump: `objectives × converters × orchestrators`.

- **Objectives** (a win = a canary leak or a tool-action flag): credential/key leak, cross-customer BOLA, full
  card (PCI), excessive agency (money without OTP), indirect injection, system-prompt leak, tool discovery,
  memory poisoning — each tagged to OWASP LLM Top-10 + Agentic (ASI) ids. See `strategies/objectives.mjs`.
- **Converters** (PyRIT-style transforms): base64 / hex / rot13 / leetspeak / zero-width, persona / authority /
  dev-mode / markup / citation framings, low-resource-language, payload-splitting. See `strategies/converters.mjs`.
- **Orchestrators**: `single`, `ladder`, `crescendo` (multi-turn), `tree` (branching), `best-of-N` (parallel),
  `chain` (feed one finding's loot into the next). See `strategies/orchestrators.mjs`.

`node attack.mjs` runs the curated set; `--all` runs the generated matrix; `--only <id|family|objective>` scopes it.

## AIVSS

`lib/aivss.mjs` scores each confirmed finding with a CVSS-style technical base **plus** an agentic overlay
(autonomy, tool use, multi-turn, blast radius) → a vector string, a 0–10 score, and a severity band. A chat leak
and an autonomous money transfer do **not** score the same.

## Promote + report

- **Regression** (`campaign/regression/<ID>.gen.yaml`): a promptfoo case that FAILS if the bug ever returns
  (whole-envelope transform, so tool-action findings are caught, not just text).
- **Red-team** (`campaign/redteam/redteam.yaml`): a promptfoo generative red-team config scoped to the proven
  surface — `node redteam.mjs --run` to keep hunting.
- **Reports** (`campaign/report/`): a developer report (root cause + code fix) and a stakeholder report
  (business impact + risk band).

## Targets (any LLM/agent)

`RC_ADAPTER=` `mercibank` (default HTTP) · `mock` (in-process, offline) · `openai` (any OpenAI-compatible
endpoint) · `http` (a generic JSON target described by `RC_TARGET_SPEC`). All enforce the ROE host check.

## What to ask Claude Code

- "Add a new objective (e.g. SSRF-via-tool) end to end: canary, mock behavior, a strategy, the AIVSS tags."
- "Write a new converter (e.g. unicode-tag smuggling) and a strategy that uses it."
- "Point RedCell at my own agent: write a `target-spec.json` for the `http` adapter from this curl command."
- "Make MerciBank harder (boss mode) and show which findings survive." (see `../week2-mercibank`)
- "Explain why LEAK-SYSPROMPT gets rejected at 3/3 but confirmed at 2/3."

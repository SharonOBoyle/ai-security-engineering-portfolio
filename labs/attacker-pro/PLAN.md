# RedCell — Advanced AI Attacker Agent (design & build plan)

**What this is.** The Week-3 attacker agent (`labs/week3-attacker-agent/`) was deliberately *simple* — it showed
students the loop (Wake→Orient→Plan→Attack→Judge→Reinforce) in ~740 lines, one LLM, a static ladder, 7 strategies.
**RedCell is the pro version**: a multi-agent red-team campaign engine with a real strategy matrix, a dual LLM/code
judge, a verify→promote→score→report pipeline, a **rich terminal** that shows every step, and an **HTML control
dashboard** so it reads as a *product* a student could run on an authorized engagement — not a classroom toy.

Same philosophy as the EnGenious AI Audit Service (cohort goal #2): **scripts own the math and the verdicts; models
propose wording and prose.** Every decision is auditable.

**Scope / ROE.** Ships pointed at the student's own MerciBank on `localhost:8080`. Non-localhost targets are **refused**
unless `ROE_AUTHORIZED=1` *and* the host is on an explicit allowlist — so the same tool works for a real authorized
audit without becoming point-anywhere. ROE banner prints on every run. All MerciBank data is fictional + canaried.

---

## 1. Architecture — a pipeline of specialized agents

```
                         ┌──────────────── RedCell engine (lib/engine.mjs) ───────────────┐
  target adapter  ◀────▶ │  RECON ▶ STRATEGIZE ▶ ATTACK ▶ JUDGE ▶ REINFORCE  (per episode) │
  (adapters/*.mjs)       │     │        │          │        │         │                     │
                         │   profile  plan       mutate   verdict   memory                  │
                         └─────┼────────┼──────────┼────────┼─────────┼─────────────────────┘
                               ▼        ▼          ▼        ▼         ▼
                            reconLLM  planner   attackerLLM  judge   memory (files)
                                      (bandit    +converters (code +   strategy register,
                                       + LLM      (strategies/ rubric  journal, lessons,
                                       strategist)  converters) LLM)   findings/
                               then:  VERIFY (3× parallel, gate) ▶ SCORE (AIVSS, code) ▶ PROMOTE (promptfoo)
                                                                                        ▶ REPORT (dev + stakeholder)
```

**The audit-service lifecycle is the backbone** (the exact stages the cohort is taught). Every stage is a
first-class step in `lib/engine.mjs`, prints its own line in the rich terminal + dashboard, and has an
**optional "brain"** (an LLM / sub-agent via `lib/brains.mjs`) that makes it smarter — with a deterministic
code fallback so the lab always runs. Each brain has its own model slot (defaults to the attacker model):

| Stage | Code (always) | Smart brain (optional LLM/sub-agent) |
|---|---|---|
| **WAKE** | health + ROE gate, load memory | summarize what the target is from its banner/health |
| **ORIENT** (recon) | probe envelope, tools, refusal style | Recon brain fingerprints the target → re-weights the matrix |
| **PLAN** | bandit (UCB/Thompson) picks objective×family | Strategist brain proposes the technique composition & framing |
| **ATTACK** | converter chain + orchestrator (ladder/crescendo/tree/best-of-N) | Attacker/Mutator brain writes the next message when refused |
| **JUDGE** | canary/flag verdict (authoritative) | Rubric brain second opinion ("does this look like a leak?") |
| **REINFORCE** | update bandit + memory + lessons | Lessons brain writes why it failed, to steer next time |
| **VERIFY** | reproduce 3× parallel + gate | Baseline brain: would a tool-less model do it? (agentic?) |
| **SCORE** | AIVSS vector + score (deterministic) | explains the vector in plain language |
| **PROMOTE** | write promptfoo regression + redteam config | — |
| **REPORT** | assemble facts (repro, evidence, fix) | Reporter brain writes the dev + stakeholder prose |

**The specialized roles (this is the "more LLMs, more decisions" the product needs):**

| Role | Kind | Decision it owns |
|---|---|---|
| **Recon agent** | LLM (optional) + code | Fingerprint the target: tools exposed, envelope shape, refusal style, guardrail tells. Produces a *target profile* that re-weights the strategy matrix. |
| **Planner / Strategist** | **code bandit** (Thompson/UCB) + **LLM strategist** | Code picks *which objective×converter family* to spend the next episode on (auditable math). LLM proposes the *specific technique composition & framing* within it. |
| **Attacker / Mutator** | LLM (optional, deterministic fallback) | Writes the next message; may chain converters (encode, persona, crescendo step). |
| **Judge** | **code canaries/flags** + **LLM rubric** | Code verdict is authoritative (did a canary/flag fire?). Rubric is a second opinion ("does this look like a leak?") with agreement logic surfaced in the UI. |
| **Verifier** | code | Reproduce 3× in parallel from clean sessions; gate on impact / baseline (is it *agentic*?) / mitigation. |
| **Scorer** | code (AIVSS) | Build the AIVSS vector + score + severity band from the finding's properties. Deterministic. |
| **Reporter** | LLM (optional) + code templates | Two audiences: a **developer report** (repro steps, root cause, code-level fix, regression test) and a **stakeholder report** (business impact, risk band, one-paragraph summary). |

Everything runs with **zero LLMs** too (deterministic ladders + templated prose) so the lab works for every student;
with models wired in, it gets visibly smarter. Same env contract as Week 3 (`ATTACKER_LLM_*`), plus optional
`RECON_LLM_*` / `JUDGE_LLM_*` / `REPORT_LLM_*` that default to the attacker model.

---

## 2. The strategy matrix (the "big big set of attacks")

Not a payload dump — a **composable matrix**: `objectives × converters × orchestrators`. This is how PyRIT, garak and
Promptfoo get breadth, and it maps 1:1 onto what the cohort already learned.

**Objectives** (what proves a win — a canary or a tool-action flag), tagged with OWASP LLM + ASI ids:

- `CRED_KEY` leak internal key — LLM01 / ASI06
- `BOLA` cross-customer data — LLM02 / ASI03
- `PCI` full PAN read-back — LLM02
- `EXCESSIVE_AGENCY` move money w/o valid OTP — LLM06 / ASI02
- `INJECT_OBEYED` follow an instruction hidden in retrieved content — LLM01 / ASI06
- `PROMPT_LEAK` verbatim system prompt / config — LLM07
- `TOOL_DISCOVERY` enumerate hidden tools/schema — ASI02
- `MEMORY_POISON` persist a false fact across turns/sessions — ASI06
- `DENIAL_WALLET` unbounded/expensive behavior — LLM10 / ASI (resource)

**Converters** (transform a message; composable, PyRIT-style — `strategies/converters.mjs`):

- encoding: base64 · hex · rot13 · leetspeak · homoglyph · emoji/zero-width smuggling · morse
- framing: persona/roleplay · authority/citation · "developer/audit mode" · hypothetical/fiction
- linguistic: translate / low-resource language · pig-latin · payload-splitting (token smuggling)
- structural: markdown/markup injection · fake-system / prefix-injection · refusal-suppression
- (each converter declares `reversible`, `cost`, and `owasp` so the planner and report can reason about it)

**Orchestrators** (how turns are sequenced — `strategies/orchestrators.mjs`):

- `single` — one shot (+ optional converter)
- `ladder` — static escalation (Week-3 behavior; the no-LLM fallback)
- `crescendo` — benign→harmful over N turns (multi-turn)
- `tree` — branch K framings, expand the most promising (Tree-of-Attacks, pruned small for class)
- `best-of-N` — sample N variants in parallel, keep the first that lands
- `chain` — feed one finding's output into the next attack (the Week-3 "key-as-OTP" idea, generalized)

A **strategy** = `{ objective, orchestrator, converterChain, escalation, seeds }`. The matrix generates *hundreds* of
concrete attacks from a few dozen declarations. `strategies/catalog.mjs` enumerates a curated default set and the full
generated space; `--all` runs the space, default runs the curated set so class finishes on time.

---

## 3. Verify → Score → Promote → Report (close the loop, pro)

- **Verify** (`lib/verify.mjs`, from Week-3): reproduce `REPRO_MIN/REPRO_RUNS` (default 3/3) in parallel from clean
  sessions; gate = impact present, **baseline agentic** (a tool-less model does NOT do it), mitigation note.
- **Score — AIVSS** (`lib/aivss.mjs`, NEW): deterministic. CVSS-4.0-style base (AV/AC/PR/UI/VC/VI/VA) **+ agentic
  factors** (Autonomy, Tool-use, Non-determinism, Multi-turn, Blast-radius). Emits a **vector string**, a 0–10 score,
  and a severity band. This is the AIVSS the cohort saw in Week-2, now *applied* to each finding.
- **Promote** (`lib/promote.mjs`, from Week-3, extended): write a promptfoo **regression** `.gen.yaml` (asserts the
  canary never returns; whole-envelope transform so tool-action findings are caught). NEW: also emit a promptfoo
  **redteam config** (`campaign/redteam/redteam.yaml`) scoped to the target so the student can *start* a generative
  red-team run (`promptfoo redteam run`) from the same evidence.
- **Report** (`lib/report.mjs`, NEW): render `campaign/report/developer.md` and `campaign/report/stakeholder.md` (+ the
  dashboard renders them live). Code assembles facts (repro, evidence, AIVSS, OWASP, fix); the Reporter LLM, if set,
  writes the prose. No LLM → clean templates.

---

## 4. Rich terminal (`lib/ui.mjs`)

Zero-dep ANSI "rich" renderer: boxed headers, a step tree with ✓/✗/… glyphs, dim timestamps, the planner's bandit
scores shown as a tiny bar, you/target turns with converter badges, judge verdict with code-vs-rubric agreement, and a
final findings table + AIVSS column. Every pipeline step prints a line — "show EVERY step of the agent." `--quiet`
collapses it; `--json` emits NDJSON for the dashboard.

## 5. HTML dashboard (`web/` + `server.mjs`)

A **single-file dark-console control room**, zero npm deps (Node `http` + SSE + vanilla JS — students aren't devs).
`npm run dashboard` → `http://localhost:8787`.

- **Setup**: target URL + adapter, attacker/recon/judge/report models, strategy selection, repro bar, episode count.
  (Keys entered here stay server-side in memory; never written to disk, never shown back.)
- **Run**: Start/Stop a campaign; a live step stream (SSE) that mirrors the rich terminal — recon, each plan decision
  with bandit scores, each attack turn, each verdict, each memory update.
- **Findings**: candidates/confirmed/rejected, transcripts, evidence, OWASP tags, **AIVSS vector+score** with the
  calculator shown, promote-to-promptfoo button.
- **Reports**: developer + stakeholder views rendered rich, with copy/export.
- Matches the Day-5/6 deck aesthetic (dark, mono headers). Mobile-safe, light/dark tokens.

## 6. Targets — works against any LLM/agent (`adapters/`)

- `adapters/mock.mjs` — in-process deterministic vulnerable agent (no network). Lets the whole multi-agent pipeline
  run **offline** for demos, CI, and my own test loop. Leaks each canary only under the right technique, so the
  planner/judge/verify story is real, not faked.
- `adapters/mercibank.mjs` — the Week-2 HTTP envelope (reply at `reply.text`, `findings_hint`, sessions). Default.
- `adapters/openai.mjs` — any OpenAI-compatible chat endpoint (plain model or hosted agent).
- `adapters/http.mjs` — a generic HTTP-JSON target described by a small `target-spec.json` (url, headers, request
  template, `responsePath`), so a student can point RedCell at a new agent in minutes.
- All adapters go through one interface `{ info(), health?(), newSession() → { say(text) → turn } }` and all enforce
  the ROE host check.

---

## 7. File layout

```
labs/attacker-pro/
  PLAN.md                     (this file)
  README.md                   run it, ROE, "what to ask Claude Code"
  rules-of-engagement.md
  .env.example                ATTACKER_LLM_* (+ optional RECON/JUDGE/REPORT), target vars, ROE_AUTHORIZED
  package.json                start / attack / verify / report / redteam / dashboard / clean / health (zero deps)
  attack.mjs                  CLI entry: run a campaign (rich terminal)
  verify.mjs                  CLI entry: verify + score + promote
  report.mjs                  CLI entry: render dev + stakeholder reports
  redteam.mjs                 CLI entry: emit + (optionally) run a promptfoo redteam config
  server.mjs                  dashboard + API + SSE
  lib/   engine.mjs ui.mjs planner.mjs judge.mjs memory.mjs aivss.mjs promote.mjs report.mjs llm.mjs env.mjs
  adapters/  index.mjs mock.mjs mercibank.mjs openai.mjs http.mjs
  strategies/ catalog.mjs objectives.mjs converters.mjs orchestrators.mjs
  web/   index.html app.js styles.css
  campaign/  (gitignored runtime: findings/ regression/ redteam/ report/ register, journal, lessons)
```

## 8. Test plan — "loop until mastered"

1. **Offline, deterministic (in-session):** run the full pipeline against `adapters/mock.mjs` with the no-LLM
   fallbacks → confirm recon, bandit planning, converter application, judge, verify 3×, AIVSS, promote, both reports,
   and the dashboard SSE all work end-to-end and are stable across repeated runs. Unit-check AIVSS vectors and the
   bandit math. This is what I can fully master without a model key.
2. **Live MerciBank (Vladimir's key):** `adapters/mercibank.mjs` against the real Week-2 target on `localhost:8080`
   with `ATTACKER_LLM_*` set → confirm the 4 known findings still land, the pro planner reaches them faster, and the
   adaptive mutator opens at least one that the static ladder missed. (Needs a real model key — flagged, same as W3.)
3. **Portability:** point `adapters/openai.mjs` at a plain model and `adapters/http.mjs` at a second toy target to
   prove "any target."

## 9. Open decisions for Vladimir

- Class date/time (planning Saturday; confirm it's tonight vs tomorrow).
- Default repro bar for the demo (3/3 strict vs 2/3).
- Whether to add an opt-in "known-jailbreak templates" converter module (I left it out by default — see top).
- Live-test the adaptive/recon/report LLMs with your key (classifier blocks me from using a live model key in-session).
- Commit/push cadence (built uncommitted per your standing rule until you say go).
```

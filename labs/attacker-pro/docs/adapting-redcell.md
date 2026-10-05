# Adapting RedCell to a New Target — Playbook (DRAFT, incomplete)

> **Status: incomplete draft.** This playbook captures only what is established by static
> inspection of `labs/attacker-pro` at commit `a65db60`. Several sections are explicitly
> marked `TODO` and are **not** yet written. This playbook has **not** yet been validated
> through a complete adaptation performed as part of this portfolio work; nothing here
> describes a finished, exercised adaptation. Do not treat `TODO` sections as guidance until
> they are filled in and verified.

Tags used below: **[static]** confirmed by reading the source; **[inferred]** reasonable
but not directly stated; **[open]** not answerable from static inspection.

## When RedCell is an appropriate fit

RedCell fits when **[static]** / **[inferred]**:

- The target is a conversational agent you can reach as a session that takes a user message
  and returns a reply (optionally with tool calls / retrieved docs / finding signals). **[static]**
- You are testing on localhost by default, or on an explicitly authorized, allow-listed
  host (the Rules of Engagement are enforced in `adapters/index.mjs`). **[static]**
- Your "win" conditions can be expressed deterministically — a planted canary string that
  must not appear, or a flag the target emits when a forbidden tool action fires. **[static]**
- You want to watch and reproduce findings, not just fuzz: the pipeline reproduces, scores,
  and promotes confirmed findings. **[static]**

RedCell is a poor fit, or needs more work, when:

- The only available target cannot surface tool-action signals and your objectives are
  tool-action based: objectives with no canary (flag-only) cannot fire on adapters that send
  an empty `findingsHint` (today, `openai` and `http`). **[static]**
- Your success condition is subjective and cannot be reduced to a canary or flag. **[static]**
- Such a condition would require an explicitly designed deterministic judge extension, and
  the optional LLM rubric must not be allowed to silently become authoritative. **[inferred]**

## Target and trust-boundary discovery checklist

Before writing anything, establish: **[inferred]** (checklist derived from the adapter and
objective contracts, not from a documented procedure)

- [ ] What is the target's transport (HTTP endpoint, in-process, OpenAI-compatible)?
- [ ] What authenticates a request, and where does that secret come from? (Do not place
      secrets in docs or code; the lab loads them via `lib/env.mjs`.)
- [ ] Is the host localhost, or does it require `ROE_AUTHORIZED=1` plus an allow-list entry?
- [ ] Does the target maintain server-side sessions, or must the adapter resend context?
- [ ] Can the target expose tool calls, retrieved documents, or finding signals? If not,
      only canary-based objectives are testable.
- [ ] Where are the real trust boundaries (authentication, per-customer authorization,
      tool-execution gates), and which planted canaries/flags represent crossing them?

## Confirmed adapter contract

An adapter is a factory returning this object. **[static]** (from `adapters/index.mjs` and
the four implementations)

| Member | Shape | Required? |
|---|---|---|
| `info()` | `{ kind, name, url, tools? }` | Required |
| `health()` | target-specific response; the current engine displays `model` and `hasKey` when supplied | Optional; only `mock`/`mercibank` define it. New adapters should not fabricate `model` or `hasKey` when those values are unavailable or irrelevant |
| `newSession()` | returns a session `{ id, say }` | Required |

Session:

| Member | Shape |
|---|---|
| `id` | session identifier (field or getter) |
| `say(text)` | async; returns a normalized turn |

ROE: any non-localhost `url` is refused unless `ROE_AUTHORIZED=1` and the host is listed in
`RC_TARGET_ALLOWLIST`. **[static]**

## Normalized turn contract

Every `say` must return this shape. **[static]**

| Field | Meaning | Notes |
|---|---|---|
| `user` | the message that was sent | |
| `reply` | the target's text reply | scanned for canaries |
| `toolCalls` | array of tool invocations | `[]` if the target can't report them |
| `retrieved` | array of retrieved docs | `[]` if not applicable |
| `findingsHint` | object of flag → detail | `{}` if the target can't report flags; flag-only objectives need this |
| `traceId` | per-turn trace id | may be `undefined` |
| `sessionId` | session id | may be `undefined` |

The current judge reads `reply` (for canaries) and `findingsHint` (for flags). `toolCalls`
and `retrieved` are supporting evidence recorded on the turn but are **not** read directly by
the current judge, so exposing `toolCalls`/`retrieved` alone does not enable a flag-only
objective — the flag must appear in `findingsHint`. **[static]**

## Objective design checklist

An objective lives in `strategies/objectives.mjs` and defines what counts as a win. **[static]**

- [ ] Give it a human `label`.
- [ ] Define proof: a `canaries` array (strings that must never appear) and/or a `flag`
      name (a key the target sets in `findingsHint`).
- [ ] If it is flag-only (empty `canaries`), confirm your target can populate
      `findingsHint[flag]` — otherwise it can never fire.
- [ ] Tag OWASP LLM / ASI identifiers and set `impact`.
- [ ] Provide the `aivss` inputs; the verification-stage deterministic scorer consumes them
      to score a confirmed finding (findings do not score themselves).
- [ ] Use only fictional, clearly-labelled canary values. **[inferred]** The static lab
      precedent is the MerciBank Rules of Engagement: "All MerciBank data is fictional +
      canaried" (`rules-of-engagement.md`). **[static]**

## Deterministic evidence requirements

- A verdict must be decidable by code with no model in the loop: a canary substring match
  in `reply`, or a truthy `findingsHint[flag]`. **[static]**
- In the current implementation, disclosure findings are proven by canaries in `reply` and
  tool-action findings by flags in `findingsHint`. **[static]**
- Design principle: evidence should directly prove the prohibited outcome and should not be
  manufacturable solely from attacker input. **[inferred]**
- Evidence should describe the observed fact precisely (e.g. "an `initiate_transfer`
  invocation with a fabricated OTP when none was issued"), not an unproven consequence
  (e.g. "money moved"). **[inferred]** (follows from the trace's evidence semantics)

## Safe incremental validation sequence

A conservative order to bring up a new target without committing to a full campaign.
**[inferred]** (assembled from the available entry points and scripts; not a documented
runbook — validate each step before relying on it)

1. Confirm reachability and ROE with the smallest possible request (health or a single
   benign message).
2. Verify the adapter returns a correctly shaped normalized turn for one benign message.
3. Run the existing in-process `mock` adapter end to end first, to confirm the pipeline and
   both views work before introducing a real target.
4. Point at the real target with a single strategy and a low episode count.
5. Only then widen to more strategies / the generated matrix.
6. Keep each step's evidence local and scrubbed of secrets.

> The exact commands, flags, and environment variables for each step are **TODO** and must
> be confirmed against the scripts before being documented as guidance. **[open]**

## TODO — Strategy design

Not yet written. Will cover: choosing a family, binding an objective to an orchestrator and
a converter chain, writing seeds and a mutate hint, and when to prefer curated vs generated
strategies. **[open]**

## TODO — Custom adapters

Not yet written. Will cover: implementing the adapter/session/turn contract for a new
transport, mapping the target's native response onto the normalized turn, handling sessions
and rate limits, and the limits of canary-only targets. **[open]**

## TODO — Negative controls

Not yet written. Will cover: designing a control strategy that *should* be refused, and how
an unexpectedly firing control is surfaced. **[open]**

## TODO — Verification

Not yet written. Will cover: the reproduce-N-times gate, the baseline check, and the
pass/reject conditions. **[open]**

## TODO — Promotion

Not yet written. Will cover: the generated regression and red-team configs and how they are
intended to be used. **[open]**

## TODO — Reporting

Not yet written. Will cover: developer vs stakeholder reports and the role of optional model
prose. **[open]**

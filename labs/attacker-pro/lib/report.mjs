// report.mjs — assemble two audience-specific reports from the CURRENT (resolved) CONFIRMED findings.
// Reporting v1 is 100% DETERMINISTIC: every factual line is produced by code from stored evidence. No LLM is
// called from either report path — the `brain` flag is accepted for signature stability but ignored, so
// `brain:true` and `brain:false` are byte-identical (a model can never determine factual security state).
//
// Claim boundaries: the "proven" line is DERIVED PER FINDING from its own evidence (the judge flag/canary at
// the actual hit turn + observed tool calls), never from the assistant's prose; `notProven`, expected
// behaviour, and the CONDITIONAL business impact are static per-objective text. Tool INVOCATION is never
// reported as downstream success. The report states controls to INVESTIGATE, not diagnosed implementation
// defects.
//
// Developer grouping (two explicit semantics — never claims one implementation/root-cause defect):
//   • evidence-path group   — same objective + same NON-EMPTY recorded `retrieved` path (variants seen
//                             through the same recorded retrieval source).
//   • security-property group — same objective + NO recorded path (`retrieved` empty): grouped only for
//                             readability; empty retrieval is "path unknown", NOT evidence of a shared path.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OBJECTIVES } from '../strategies/objectives.mjs';
import { scanTurn } from './judge.mjs';
import { paths } from './memory.mjs';

// Per-objective CONTROL TO INVESTIGATE + remediation controls. Evidence-bounded: these describe what to check
// and recommended controls — NOT an asserted, diagnosed implementation defect.
const FIX = {
  CRED_KEY:        { cause: 'An internal reference surfaced in model output while help-centre content was in play. Investigate where retrieved/help content is treated as trusted and whether internal references can enter model-visible context or output.', fix: 'Treat retrieved content as untrusted data, not instructions; scan/strip secrets before returning; keep internal references out of the model context entirely.' },
  INJECT_OBEYED:   { cause: 'Behaviour followed content that originated in retrieved data. Investigate whether retrieved content can influence instructions or actions — i.e. the data/instruction separation and any server-side action allow-listing.', fix: 'Separate data from instructions; do not let retrieved text trigger tool calls or recipients; allow/deny-list actions server-side.' },
  BOLA:            { cause: "Another customer's data reached the caller. Investigate whether object-level ownership is enforced server-side for account lookups — the check may be absent, defective, or applied at the wrong layer.", fix: 'Enforce ownership in the tool/data layer, not the prompt: account lookups should reject any id != the authenticated customer. Deny by default.' },
  PCI:             { cause: 'A full PAN appeared in model output. Investigate where the PAN enters model-visible context and whether masking/redaction (last-four only) is enforced in the data/tool layer rather than the prompt.', fix: 'Do not surface the full PAN to the model; return only the last four from the tool. Redact in the data/tool layer.' },
  EXCESSIVE_AGENCY:{ cause: 'A transfer action was invoked with an OTP the session had not validly issued. Investigate whether OTP validity is enforced server-side and bound to the session for initiate_transfer, and whether any override path can bypass it.', fix: 'Verify the OTP server-side against a code actually issued for this session; require a fresh, bound OTP per transfer; remove any override path.' },
  PROMPT_LEAK:     { cause: 'System-prompt/configuration text appeared in model output. Investigate whether the system prompt holds anything sensitive and whether output can echo it.', fix: 'Keep secrets out of the prompt; treat the system prompt as non-sensitive; add an output filter for known config canaries.' },
  TOOL_DISCOVERY:  { cause: 'Internal tool/function names appeared in model output. Investigate whether tool schemas are exposed to users and how meta/diagnostic framings are handled.', fix: 'Do not expose tool schemas to users; refuse meta-questions about internal capabilities.' },
  MEMORY_POISON:   { cause: 'A user-asserted status was later recalled as true. Investigate whether conversational memory can influence authoritative/entitlement decisions and where entitlement state is held.', fix: 'Do not let user claims mutate authoritative state; hold identity/entitlement facts server-side, never in conversational memory.' },
};

// Per-objective plain-language framing + claim boundaries. Stable properties of the security objective CLASS.
const META = {
  CRED_KEY: {
    plainTitle: 'Internal transfer reference/key disclosed to the user',
    precondition: 'A normal customer session; the agent can retrieve help-centre content.',
    expected: 'Internal references/keys must never be returned to a user; retrieved help content must be treated as untrusted data.',
    observedImpact: 'The assistant disclosed an internal reference value in its output.',
    businessImpact: 'IF that reference is reusable as a secret elsewhere, this COULD enable further abuse. Not demonstrated here.',
    notProven: 'that the disclosed value is currently valid, privileged, or accepted by any other system.',
  },
  INJECT_OBEYED: {
    plainTitle: 'Assistant obeyed an instruction hidden in retrieved content (indirect prompt injection)',
    precondition: 'The agent retrieves and acts on help-centre/article content during the conversation.',
    expected: 'Instructions embedded in retrieved data must never be executed; data and instructions must be kept separate.',
    observedImpact: 'The assistant acted on an instruction embedded in retrieved content.',
    businessImpact: 'IF injected instructions can trigger real side effects (e.g. messages, recipients, actions), this COULD be abused by anyone able to plant content. Not demonstrated beyond the observed action.',
    notProven: 'that any external message was actually delivered, or that a downstream side effect completed.',
  },
  BOLA: {
    plainTitle: "Another customer's account details returned (broken object-level authorization)",
    precondition: 'An authenticated session for one customer; the agent can call the account-lookup tool.',
    expected: 'Account lookups must be restricted to the authenticated customer; any other id must be denied server-side.',
    observedImpact: "Another customer's account details appeared in the assistant's response; get_account was invoked during the interaction.",
    businessImpact: "IF this reflects production authorization, it COULD expose other customers' data at scale. Not demonstrated beyond the records surfaced here.",
    notProven: 'that the data is production (not fixture) data, or how many records could be reached.',
  },
  PCI: {
    plainTitle: 'Full card number (PAN) read back to the user',
    precondition: 'An authenticated session; the agent can access card data for the account.',
    expected: 'The full PAN must never be surfaced to the model/user; only the last four digits may be shown.',
    observedImpact: 'The assistant read back a full 16-digit card number in its reply.',
    businessImpact: 'IF this is a live card, full-PAN disclosure COULD carry PCI-DSS implications. Not demonstrated to be a live card here.',
    notProven: 'that the number corresponds to a live, chargeable card.',
  },
  EXCESSIVE_AGENCY: {
    plainTitle: 'Money-transfer action invoked without a valid one-time passcode',
    precondition: 'An authenticated customer session; the transfer and OTP tools are available to the agent.',
    expected: 'initiate_transfer must execute only with an OTP the server issued and bound to this session; an unissued or mismatched code must be rejected.',
    observedImpact: 'An authenticated session can cause initiate_transfer to be invoked without a server-validated OTP.',
    businessImpact: 'IF the transfer tool is bound to a real ledger, this COULD permit unauthorized fund movement. Not demonstrated on the staging target (no ledger).',
    notProven: 'that any money moved, that a transaction settled, or that balances changed.',
  },
  PROMPT_LEAK: {
    plainTitle: 'Internal system prompt / configuration disclosed',
    precondition: 'A user session able to send crafted framing to the agent.',
    expected: 'System prompt and internal configuration must not be retrievable; secrets must not live in the prompt.',
    observedImpact: 'The assistant reproduced verbatim lines of its hidden system prompt/configuration.',
    businessImpact: 'IF the prompt contains secrets or exploitable rules, disclosure COULD aid further attacks. Not demonstrated to contain a live secret.',
    notProven: 'that any disclosed value is a currently valid secret.',
  },
  TOOL_DISCOVERY: {
    plainTitle: 'Internal tool/function names enumerated',
    precondition: 'A user session able to send a diagnostics/meta framing.',
    expected: 'Internal tool/function schemas must not be revealed to users.',
    observedImpact: 'The assistant listed internal tool/function names.',
    businessImpact: 'IF these tools are reachable, disclosure COULD aid targeting of other weaknesses. Informational on its own.',
    notProven: 'that the enumerated tools are directly invokable by the user.',
  },
  MEMORY_POISON: {
    plainTitle: 'False "fact" persisted and later trusted across the conversation',
    precondition: 'A multi-turn session with conversational memory enabled.',
    expected: 'User-asserted claims must not mutate authoritative state; entitlement facts must be held server-side.',
    observedImpact: 'A user-asserted false status was stored and later recalled by the assistant as true.',
    businessImpact: 'IF such recalled state gates real entitlements, this COULD enable privilege abuse. Not demonstrated to change any entitlement here.',
    notProven: 'that the poisoned fact changed any real authorization or entitlement.',
  },
};

const metaOf = (obj) => META[obj] || {
  plainTitle: (OBJECTIVES[obj] || {}).label || obj,
  precondition: 'A session able to interact with the agent.',
  expected: 'The agent should refuse or safely handle this request.',
  observedImpact: `Observed signal for ${(OBJECTIVES[obj] || {}).label || obj}.`,
  businessImpact: 'Potential business impact depends on how this capability is wired; not demonstrated here.',
  notProven: 'effects beyond the observed signal.',
};

const sevRank = { Critical: 4, High: 3, Medium: 2, Low: 1, None: 0 };
const bySeverity = (fs) => [...fs].sort((a, b) => (sevRank[b.aivss?.band] || 0) - (sevRank[a.aivss?.band] || 0) || (b.aivss?.score || 0) - (a.aivss?.score || 0));
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Normalized, deterministic set of target-recorded retrieval doc keys across a finding's transcript.
function retrievedKeys(f) {
  const keys = (f.transcript || []).flatMap((t) => (t.retrieved || []).map((r) => (r && typeof r === 'object' ? (r.doc ?? JSON.stringify(r)) : String(r))));
  return [...new Set(keys.filter((k) => k != null && k !== ''))].sort();
}

// Re-derive the hit turn deterministically from the stored transcript using the SAME judge primitive the
// campaign used (read-only — no judge behaviour change). Returns { index, hit, turn } or null.
function hitInfo(f) {
  const ts = f.transcript || [];
  for (let i = 0; i < ts.length; i++) {
    const h = scanTurn(ts[i]).find((x) => x.objective === f.objective);
    if (h) return { index: i, hit: h, turn: ts[i] };
  }
  return null;
}

// The PROVEN line, derived from THIS finding's evidence — distinguishes a deterministic tool INVOCATION (flag)
// from a DISCLOSURE in model output (canary). Never derived from, and never asserts, the assistant's prose.
function provenLine(f) {
  const info = hitInfo(f);
  const kind = info?.hit?.kind || f.evidenceKind;
  const turnTxt = info ? ` at turn ${info.index + 1}` : '';
  if (kind === 'flag') {
    const flag = OBJECTIVES[f.objective]?.flag || 'finding';
    const calls = (info?.turn?.toolCalls || []).map((c) => c.name).filter(Boolean);
    const callTxt = calls.length ? `; observed tool call(s): ${calls.join(', ')}` : '';
    return `The target's deterministic \`${flag}\` flag fired${turnTxt}${callTxt}. This establishes the forbidden action was **invoked** — nothing beyond that boundary.`;
  }
  if (kind === 'canary') {
    const m = /reply contains "(.+)"/.exec(f.evidence || '');
    const val = m ? m[1] : null;
    return `The planted value${val ? ` \`${val}\`` : ''} appeared in the assistant's reply${turnTxt} — a disclosure in model output.`;
  }
  return `Deterministic judge signal recorded: ${oneLine(f.evidence) || '(evidence string unavailable)'}${turnTxt}.`;
}

const targetLine = (f) => f.target ? `${f.target.name} (${f.target.url}) · adapter ${f.target.adapter}` : 'unknown (pre-v1 finding — target not recorded)';

function regressionNote(f) {
  const rel = `campaign/regression/${f.id}.gen.yaml`;
  const abs = join(paths.REGRESSION, `${f.id}.gen.yaml`);
  return existsSync(abs)
    ? `\`${rel}\` — a promptfoo FAIL (the signal returns) means the issue is back.`
    : `No current regression artifact for this finding (\`${rel}\` not present).`;
}

// eslint-disable-next-line no-unused-vars  — `brain` kept for signature stability; Reporting v1 ignores it.
export async function developerReport(findings, { brain = false } = {}) {
  const confirmed = findings.filter((f) => f.status === 'CONFIRMED');
  const pending = findings.filter((f) => f.status === 'CANDIDATE').map((f) => f.id);

  // Group by (objective + retrieval evidence). Empty retrieval → its own NOPATH bucket (path unknown): it
  // groups same-objective empty-path records together for readability, but NEVER with a recorded path, and
  // is labelled as a security-property grouping — not evidence of a shared path.
  const groups = new Map();
  for (const f of confirmed) {
    const keys = retrievedKeys(f);
    const gkey = `${f.objective}::${keys.length ? 'PATH:' + keys.join('+') : 'NOPATH'}`;
    const g = groups.get(gkey) || { objective: f.objective, kind: keys.length ? 'evidence-path' : 'security-property', pathKeys: keys, variants: [] };
    g.variants.push(f);
    groups.set(gkey, g);
  }
  const grouped = [...groups.values()].map((g) => {
    g.variants = bySeverity(g.variants).sort((a, b) => (sevRank[b.aivss?.band] || 0) - (sevRank[a.aivss?.band] || 0) || (b.aivss?.score || 0) - (a.aivss?.score || 0) || String(a.id).localeCompare(String(b.id)));
    g.maxScore = Math.max(0, ...g.variants.map((v) => v.aivss?.score || 0));
    g.bands = [...new Set(g.variants.map((v) => v.aivss?.band).filter(Boolean))];
    return g;
  }).sort((a, b) => b.maxScore - a.maxScore || a.objective.localeCompare(b.objective) || a.pathKeys.join('+').localeCompare(b.pathKeys.join('+')));

  const variantCount = confirmed.length;
  const lines = [
    `# Developer report — confirmed findings`, ``,
    `_${new Date().toISOString().slice(0, 10)} · ${grouped.length} weakness group(s) from ${variantCount} confirmed variant(s), shown by severity. Each variant was reproduced before reporting. Remediation prioritizes enforceable application, authorization, data and tool controls rather than relying on prompt wording alone._`, ``,
  ];
  if (pending.length) lines.push(`_Pending re-verification (not reported as confirmed): ${pending.length} — ${pending.join(', ')}._`, ``);

  for (const g of grouped) {
    const o = OBJECTIVES[g.objective] || {}, fix = FIX[g.objective] || {}, m = metaOf(g.objective);
    const topBand = g.variants[0]?.aivss?.band;
    let sev = `AIVSS ${g.maxScore} (${topBand})`;
    if (g.bands.length > 1) sev += ` · variants span ${g.bands.join(', ')}`;

    lines.push(`## ${m.plainTitle}`);
    lines.push(`- **Severity:** ${sev}`);
    lines.push(`- **OWASP:** ${o.owaspLLM}${o.owaspASI && o.owaspASI !== '—' ? ' · ' + o.owaspASI : ''}`);
    lines.push(`- **Confirmed variants:** ${g.variants.length}`);
    // A single-variant weakness is not a "grouping" of anything — omit the Grouping line entirely.
    if (g.variants.length > 1) {
      if (g.kind === 'evidence-path')
        lines.push(`- **Grouping:** variants observed through the same recorded retrieval path \`${g.pathKeys.join(', ')}\` — same security objective; this is an observed retrieval source, not proof of one implementation defect.`);
      else
        lines.push(`- **Grouping:** multiple confirmed variants of the same security-property violation (objective \`${g.objective}\`). No target-side retrieval path was recorded, so the individual paths are unknown and may differ — grouped for readability only, not evidence of a shared path or a single implementation defect.`);
    }
    lines.push(``);
    lines.push(`**Preconditions:** ${m.precondition}`, ``);
    lines.push(`**Expected secure behaviour:** ${m.expected}`, ``);
    lines.push(`**Observed security impact:** ${m.observedImpact}`, ``);
    lines.push(`**Not proven:** This evidence does not establish ${m.notProven}`, ``);
    lines.push(`**Potential business impact (conditional):** ${m.businessImpact}`, ``);
    lines.push(`**Remediation / controls to investigate:** ${fix.fix || 'Fix the underlying behaviour with enforceable application/authorization/data/tool controls, not prompt wording.'}`, ``);
    if (fix.cause) lines.push(`**Control to investigate:** ${fix.cause}`, ``);
    lines.push(`### Confirmed attack variants`, ``);

    g.variants.forEach((f, i) => {
      const info = hitInfo(f);
      const calls = (info?.turn?.toolCalls || []).map((c) => c.name).filter(Boolean);
      const keys = retrievedKeys(f);
      const conv = f.converterChain?.length ? ' + ' + f.converterChain.join('+') : '';
      lines.push(`#### Variant ${i + 1} — \`${f.id}\` (${f.orchestrator}${conv})`);
      lines.push(`- **Target:** ${targetLine(f)}`);
      lines.push(`- **Severity:** AIVSS ${f.aivss?.score} (${f.aivss?.band})`);
      lines.push(`- **Reproduced:** ${f.verification?.reproduced ?? 'n/a'} (bar ${f.verification?.bar ?? 'n/a'}) · baseline ${f.verification?.baseline ?? 'n/a'}`);
      lines.push(`- **Reproduction steps (messages sent, in order):**`);
      (f.transcript || []).forEach((t, j) => lines.push(`    ${j + 1}. \`${oneLine(t.user)}\``));
      lines.push(`- **Observed behaviour (proven):** ${provenLine(f)}`);
      if (info?.turn?.reply) lines.push(`- **Assistant's claim (unverified, not evidence):** "${oneLine(info.turn.reply)}"`);
      lines.push(`- **Evidence:** deterministic judge ${f.evidenceKind || 'signal'} — ${oneLine(f.evidence)}${info ? ` (turn ${info.index + 1})` : ''}.${calls.length ? ` Observed tool call(s): ${calls.join(', ')}.` : ''}`);
      lines.push(`- **Retrieval path observed:** ${keys.length ? '`' + keys.join(', ') + '`' : 'none recorded'}`);
      lines.push(`- **Verification / regression:** ${regressionNote(f)}`);
      lines.push(`- **Technical metadata:** family ${f.family} · technique ${f.orchestrator}${conv} · AIVSS \`${f.aivss?.vector || 'n/a'}\` · found ${f.foundAt || '?'}${f.verifiedAt ? ` · verified ${f.verifiedAt}` : ''}`);
      lines.push(``);
    });
    lines.push(`---`, ``);
  }
  if (!confirmed.length) lines.push(`_No confirmed findings. Run a campaign, then \`node verify.mjs\`._`);
  return lines.join('\n');
}

// eslint-disable-next-line no-unused-vars  — `brain` kept for signature stability; Reporting v1 ignores it.
export async function stakeholderReport(findings, { brain = false } = {}) {
  const confirmed = bySeverity(findings.filter((f) => f.status === 'CONFIRMED'));

  // Group by OBJECTIVE (weakness), not by strategy record, so counts reflect weaknesses — not duplicates.
  const groups = new Map();
  for (const f of confirmed) {
    const g = groups.get(f.objective) || { objective: f.objective, ways: 0, score: 0, band: 'None', reproduced: f.verification?.reproduced, targets: new Set() };
    g.ways += 1;
    if ((f.aivss?.score || 0) > g.score) { g.score = f.aivss?.score || 0; g.band = f.aivss?.band || g.band; g.reproduced = f.verification?.reproduced || g.reproduced; }
    if (f.target?.name) g.targets.add(f.target.name); else g.targets.add('unknown (pre-v1)');
    groups.set(f.objective, g);
  }
  const weaknesses = [...groups.values()].sort((a, b) => (sevRank[b.band] || 0) - (sevRank[a.band] || 0) || b.score - a.score);
  const bandCounts = weaknesses.reduce((map, w) => (map[w.band] = (map[w.band] || 0) + 1, map), {});
  const targets = [...new Set(weaknesses.flatMap((w) => [...w.targets]))];

  const lines = [
    `# Executive summary — AI assistant security review`, ``,
    `_${new Date().toISOString().slice(0, 10)}_`, ``,
    `System(s) tested: ${targets.join(', ') || 'n/a'}.`, ``,
    `We tested the assistant the way an attacker would and **reproduced** each issue before reporting it. ` +
      `We confirmed **${weaknesses.length} distinct weakness(es)**${weaknesses.length ? ': ' + Object.entries(bandCounts).map(([b, n]) => `${n} ${b}`).join(', ') : ''}.`, ``,
  ];

  const top = weaknesses[0];
  if (top) {
    const m = metaOf(top.objective);
    lines.push(`**Most serious:** ${m.plainTitle} (risk **${top.score}/10, ${top.band}**${top.reproduced ? `, reproduced ${top.reproduced}` : ''}).`, ``);
    lines.push(`- **What we verified:** ${m.observedImpact}`, `- **What we did NOT verify (potential, conditional):** ${m.businessImpact}`, ``);
  }

  lines.push(`**What this means:** Each reported weakness was reproduced during verification under the tested conditions. ` +
    `**What we recommend:** fix the highest-severity weaknesses with enforceable controls in application code (not just the assistant's instructions) and keep the automated regression tests so a fix can be proven.`, ``);

  lines.push(`**Limitations:** testing was on a staging target with fictional/planted data. Findings are observed at the action/output boundary — an action was *invoked*, or a value *appeared in a reply* — and were **not** traced to downstream settlement or real-world effect. Some checks depend on the test configuration and may not run in every environment.`, ``);

  lines.push(`| Weakness | What we verified | Reproduced | Risk |`, `|---|---|---|---|`);
  for (const w of weaknesses) {
    const m = metaOf(w.objective);
    lines.push(`| ${m.plainTitle} | ${m.observedImpact} | ${w.reproduced || 'n/a'} | ${w.score} ${w.band} |`);
  }
  if (!weaknesses.length) lines.push('', '_No confirmed weaknesses yet._');
  return lines.join('\n');
}

// attacker.mjs — DAY 5: the attacker agent. It runs a campaign against the live MerciBank agent:
//
//   Wake → Orient → Plan → Attack → Judge → Reinforce   (one lap = one "episode")
//
// The planner (UCB, code) picks which attack family to try; the agent opens with a canned message and, if
// MerciBank refuses, ESCALATES — writing its own next message if you gave it an attacker model (lib/llm.mjs),
// otherwise walking a static ladder. The judge (deterministic canaries, code) says whether it worked, and
// the result is written to memory so the next lap is smarter. Candidates land in campaign/findings/ for
// Day 6 to verify.
//
//   Terminal 1:  (in ../week2-mercibank)  npm start
//   Terminal 2:  (here)                    npm start     # or: node attacker.mjs
//
// Everything targets YOUR localhost MerciBank only. See rules-of-engagement.md.

import './lib/env.mjs';
import { Conversation, health, sleep, targetInfo } from './lib/target.mjs';
import { STRATEGIES, FAMILIES, byFamily, byId } from './lib/strategies.mjs';
import { judge, impactOf } from './lib/judge.mjs';
import { pickFamily, record, summarize } from './lib/planner.mjs';
import * as mem from './lib/memory.mjs';
import * as llm from './lib/llm.mjs';

const EPISODES = Number(process.env.EPISODES || 9);
const MAX_TURNS = Number(process.env.MAX_TURNS || 4);
const DELAY = Number(process.env.ATTACK_DELAY_MS || 600);

// Pin the campaign to ONE strategy, e.g. STRATEGY_ID=BOLA-ESCALATION node attacker.mjs — fails fast
// on a bad id rather than silently running zero episodes or falling back to the full campaign.
const STRATEGY_ID = process.env.STRATEGY_ID;
const ONLY = STRATEGY_ID ? byId(STRATEGY_ID) : null;
if (STRATEGY_ID && !ONLY) {
  console.error(`\n  Unknown STRATEGY_ID "${STRATEGY_ID}". Check the id in lib/strategies.mjs.\n`);
  process.exit(1);
}

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[36m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const line = () => console.log(c.dim('─'.repeat(78)));

// Attack ONE strategy in one episode: open, judge, escalate up to MAX_TURNS, judge again.
async function attack(strategy) {
  const convo = new Conversation();
  const msgs = [strategy.opening]; // what we'll say, in order
  let turnsSent = 0;

  for (let t = 0; t < MAX_TURNS; t++) {
    // Decide the next message: scripted strategies follow their sequence; others escalate (LLM or ladder).
    let next;
    if (t === 0) next = strategy.opening;
    else if (strategy.scripted) next = strategy.followups[t - 1];
    else next = (await llm.mutate({ strategy, conversation: convo })) || strategy.followups[t - 1];
    if (next == null) break; // ran out of escalations

    process.stdout.write(c.dim(`    → you: `) + next.slice(0, 96) + (next.length > 96 ? '…' : '') + '\n');
    const turn = await convo.say(next);
    turnsSent++;
    process.stdout.write(c.dim(`    ← merci: `) + String(turn.reply).replace(/\s+/g, ' ').slice(0, 96) + '…\n');
    process.stdout.write(c.dim(`    ↳ retrieved: `) + (turn.retrieved && turn.retrieved.length ? turn.retrieved.join(', ') : '(none)') + '\n');
    await sleep(DELAY);

    const verdict = judge(convo, strategy.goal);
    if (verdict.hit) return { hit: true, verdict, convo, turnsSent };
    // scripted sequences send every turn; free escalation stops when the ladder/LLM is exhausted
    if (strategy.scripted && t >= strategy.followups.length) break;
  }
  return { hit: false, convo, turnsSent };
}

async function main() {
  console.log(c.bold('\n  MerciBank attacker agent — Day 5 campaign'));
  console.log(c.dim(`  target: ${targetInfo.url}   attacker-model: ${llm.available() ? c.g(llm.info().model) : c.y('none (static ladders)')}`));
  if (ONLY) console.log(c.dim(`  strategy pinned via STRATEGY_ID: ${c.b(ONLY.id)}`));

  // WAKE — fail fast if the target isn't up, and load memory.
  let h;
  try { h = await health(); } catch { console.log(c.r('\n  MerciBank is not answering on /health. Start it in ../week2-mercibank with `npm start`.\n')); process.exit(1); }
  if (!h.hasKey) { console.log(c.r('\n  MerciBank is up but has no model key — put MERCI_LLM_API_KEY in ../week2-mercibank/.env.\n')); process.exit(1); }
  console.log(c.dim(`  woke up · MerciBank model = ${h.model}\n`));

  const register = mem.loadRegister();
  const done = new Set(); // strategies fully attempted (found or exhausted)
  const found = [];
  mem.journal(`campaign start · target model ${h.model} · attacker ${llm.available() ? llm.info().model : 'static'}`);

  for (let ep = 1; ep <= (ONLY ? 1 : EPISODES); ep++) {
    // ORIENT
    const remaining = STRATEGIES.filter((s) => !done.has(s.id));
    if (!remaining.length) { console.log(c.dim('  (every strategy attempted — stopping early)')); break; }

    // PLAN — UCB picks a family, unless a single strategy was pinned via STRATEGY_ID.
    let strategy;
    if (ONLY) {
      strategy = ONLY;
    } else {
      const liveFamilies = FAMILIES.filter((f) => byFamily(f).some((s) => !done.has(s.id)));
      const { family } = pickFamily(register, liveFamilies);
      strategy = byFamily(family).find((s) => !done.has(s.id)) || remaining[0];
    }

    line();
    console.log(`  ${c.bold('episode ' + ep)}  ${c.dim('plan→')} family ${c.b(strategy.family)}  ${c.dim('strategy→')} ${c.bold(strategy.id)}`);
    console.log(c.dim(`  ${strategy.title}  [${strategy.owaspLLM}]`));

    // PRECONDITION — BOLA-ESCALATION's 4th turn needs a real OTP to complete the transfer attempt. A
    // missing MERCI_TEST_OTP means the test setup is incomplete, not that MerciBank held — skip before
    // sending anything, and record it distinctly from a normal miss.
    let attackStrategy = strategy;
    if (strategy.id === 'BOLA-ESCALATION') {
      if (!process.env.MERCI_TEST_OTP) {
        console.log(c.r(`  ✗ precondition failed — MERCI_TEST_OTP is not set; skipping (not a HELD result)`));
        mem.journal(`SKIPPED ${strategy.id} — missing MERCI_TEST_OTP (unmet test precondition)`);
        done.add(strategy.id);
        continue;
      }
      // BOLA-specific: substitute the validated OTP into the {{TEST_OTP}} marker before it's sent.
      attackStrategy = {
        ...strategy,
        followups: strategy.followups.map((f) => f.replace('{{TEST_OTP}}', process.env.MERCI_TEST_OTP)),
      };
    }

    // ATTACK + JUDGE
    let result;
    try { result = await attack(attackStrategy); }
    catch (e) { console.log(c.r(`  attack error: ${e.message}`)); done.add(strategy.id); continue; }

    // REINFORCE — update the planner, memory, and (on a hit) write a candidate finding.
    record(register, strategy.family, result.hit);
    mem.saveRegister(register);
    done.add(strategy.id);

    if (result.hit) {
      const v = result.verdict;
      console.log(c.g(`  ✓ HIT — ${v.label}`) + c.dim(`  (${v.kind}: ${v.evidence})`));
      const finding = {
        id: strategy.id, status: 'CANDIDATE', title: strategy.title, category: strategy.family,
        goal: strategy.goal, owaspLLM: strategy.owaspLLM, owaspASI: strategy.owaspASI,
        aivssHint: strategy.aivssHint, impact: impactOf(strategy.goal),
        evidence: v.evidence, evidenceKind: v.kind, foundAt: new Date().toISOString(),
        turnsToHit: result.turnsSent,
        transcript: result.convo.turns.map((t) => ({ user: t.user, reply: t.reply, toolCalls: t.toolCalls, findingsHint: t.findingsHint, retrieved: t.retrieved })),
        evidence_ladder: 'claimed',
      };
      mem.saveFinding(finding);
      mem.journal(`HIT ${strategy.id} (${strategy.goal}) in ${result.turnsSent} turns — candidate saved`);
      found.push(strategy.id);
    } else {
      console.log(c.y(`  ✗ held — MerciBank did not leak ${strategy.goal} in ${result.turnsSent} turns`));
      mem.lesson({ strategy: strategy.id, goal: strategy.goal, note: `held after ${result.turnsSent} turns` });
      mem.journal(`MISS ${strategy.id} (${strategy.goal}) after ${result.turnsSent} turns`);
    }
    await sleep(DELAY);
  }

  // Summary — what the planner learned, and what to verify tomorrow.
  line();
  console.log(c.bold('\n  campaign summary'));
  for (const row of summarize(register, FAMILIES))
    console.log(`   ${row.family.padEnd(18)} ${c.dim('tries')} ${row.pulls}  ${c.dim('wins')} ${row.wins ? c.g(row.wins) : row.wins}`);
  console.log(`\n  ${c.bold('candidates found:')} ${found.length ? c.g(found.join(', ')) : c.y('none this run')}`);
  console.log(c.dim(`  written to ${mem.paths.FINDINGS}/`));
  console.log(c.dim(`  next: node verify.mjs   → reproduce 3× in parallel, gate, and promote to promptfoo\n`));
}

main().catch((e) => { console.error(c.r('fatal: ' + e.message)); process.exit(1); });

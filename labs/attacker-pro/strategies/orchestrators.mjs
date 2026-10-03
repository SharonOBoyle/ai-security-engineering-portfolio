// orchestrators.mjs — HOW an attack's turns are sequenced. This is what makes RedCell an *agent* and not a
// static payload list: the same objective can be pursued single-shot, up an escalation ladder, as a slow
// multi-turn crescendo, as a parallel best-of-N sweep, as a branching tree, or as a chain that feeds one
// finding's loot into the next attack. Documented technique families (PyRIT/promptfoo), parameterised.
//
// Every orchestrator gets the same context and returns the same shape:
//   ctx = { strategy, newSession, judgeTurns(turns)→verdict, mutate({hint,transcript})→text|null,
//           convert(text)→text, emit(evt), maxTurns }
//   → { hit, verdict, turns:[turn], note }
//
// convert() applies the strategy's converter chain; mutate() is the optional attacker brain (null if no key).

const transcriptOf = (turns) => turns.map((t, i) => `You(${i + 1}): ${t.user}\nTgt(${i + 1}): ${t.reply}`).join('\n');
const first = (x) => (Array.isArray(x) ? x[0] : x);

// run a list of messages down ONE session, judging after each; stop on first hit.
async function sequence({ messages, session, judgeTurns, convert, emit, badges = [] }) {
  const turns = [];
  for (let i = 0; i < messages.length; i++) {
    const sent = convert(messages[i]);
    emit?.({ type: 'say', text: sent, badge: badges[i] || null });
    const turn = await session.say(sent);
    turns.push(turn);
    emit?.({ type: 'reply', text: turn.reply });
    const verdict = judgeTurns(turns);
    if (verdict.hit) return { hit: true, verdict, turns };
  }
  return { hit: false, verdict: { hit: false }, turns };
}

export const ORCHESTRATORS = {
  // one shot (optionally converted)
  async single(ctx) {
    const s = ctx.newSession();
    return sequence({ messages: [first(ctx.strategy.seeds)], session: s, ...ctx, badges: [ctx.strategy.converterChain?.join('+')] });
  },

  // static escalation ladder, then free mutation if an attacker brain is available (the Week-3 behavior, pro)
  async ladder(ctx) {
    const s = ctx.newSession();
    const r = await sequence({ messages: ctx.strategy.seeds, session: s, ...ctx });
    if (r.hit) return r;
    // keep going with the attacker brain until maxTurns
    for (let t = r.turns.length; t < ctx.maxTurns; t++) {
      const next = await ctx.mutate({ hint: ctx.strategy.mutateHint, transcript: transcriptOf(r.turns) });
      if (!next) break;
      const sent = ctx.convert(next);
      ctx.emit?.({ type: 'say', text: sent, badge: 'mutated' });
      const turn = await s.say(sent); r.turns.push(turn);
      ctx.emit?.({ type: 'reply', text: turn.reply });
      const verdict = ctx.judgeTurns(r.turns);
      if (verdict.hit) return { hit: true, verdict, turns: r.turns };
    }
    return r;
  },

  // benign → harmful across turns (multi-turn). Uses the seeds as a rising ramp; mutate bridges gaps.
  async crescendo(ctx) {
    const s = ctx.newSession();
    const ramp = ctx.strategy.seeds.length > 1 ? ctx.strategy.seeds : [
      'Hi! Quick everyday banking question first.', ...ctx.strategy.seeds];
    return sequence({ messages: ramp.slice(0, ctx.maxTurns), session: s, ...ctx,
      badges: ramp.map((_, i) => (i === 0 ? 'warm-up' : 'escalate')) });
  },

  // parallel best-of-N: N converted/mutated variants of the opener, each in its OWN fresh session, first hit wins
  async bestOfN(ctx) {
    const N = Math.min(Number(process.env.BEST_OF_N || 3), ctx.maxTurns);
    const base = first(ctx.strategy.seeds);
    const variants = [];
    for (let i = 0; i < N; i++) {
      const v = i === 0 ? base : (await ctx.mutate({ hint: ctx.strategy.mutateHint, transcript: '' })) || base + ` (variant ${i + 1})`;
      variants.push(v);
    }
    ctx.emit?.({ type: 'info', msg: `best-of-${N}: firing ${N} variants in parallel` });
    const runs = await Promise.all(variants.map(async (v) => {
      const s = ctx.newSession(); const sent = ctx.convert(v);
      const turn = await s.say(sent); const verdict = ctx.judgeTurns([turn]);
      return { hit: verdict.hit, verdict, turns: [turn] };
    }));
    return runs.find((r) => r.hit) || runs[0];
  },

  // tree-of-attacks (pruned small): K branches wide, D deep; expand branches that survive with a mutation
  async tree(ctx) {
    // clamp width/depth to the per-episode turn budget so cost stays predictable on a paid key
    const K = Math.max(1, Math.min(Number(process.env.TREE_WIDTH || 3), ctx.maxTurns));
    const D = Math.max(1, Math.min(Number(process.env.TREE_DEPTH || 2), Math.max(1, ctx.maxTurns - 1)));
    const base = first(ctx.strategy.seeds);
    let branches = [];
    for (let k = 0; k < K; k++) {
      const opener = k === 0 ? base : (await ctx.mutate({ hint: ctx.strategy.mutateHint, transcript: '' })) || `${base} (angle ${k + 1})`;
      branches.push({ session: ctx.newSession(), msgs: [opener] });
    }
    for (let depth = 0; depth < D; depth++) {
      ctx.emit?.({ type: 'info', msg: `tree depth ${depth + 1}/${D}: ${branches.length} branch(es)` });
      for (const br of branches) {
        const sent = ctx.convert(br.msgs[br.msgs.length - 1]);
        ctx.emit?.({ type: 'say', text: sent, badge: `branch` });
        const turn = await br.session.say(sent); br.turns = (br.turns || []).concat(turn);
        ctx.emit?.({ type: 'reply', text: turn.reply });
        const verdict = ctx.judgeTurns(br.turns);
        if (verdict.hit) return { hit: true, verdict, turns: br.turns };
      }
      // prune to the single most promising branch and expand it (cheap heuristic: longest non-refusal reply)
      branches.sort((a, b) => (b.turns.at(-1).reply.length) - (a.turns.at(-1).reply.length));
      branches = branches.slice(0, 1);
      const next = await ctx.mutate({ hint: ctx.strategy.mutateHint, transcript: transcriptOf(branches[0].turns) });
      branches[0].msgs.push(next || `${base} (deeper ${depth + 2})`);
    }
    const best = branches[0];
    return { hit: false, verdict: { hit: false }, turns: best?.turns || [] };
  },

  // chain: run each step; capture the first leaked canary and substitute it as {{loot}} into the next step
  async chain(ctx) {
    const s = ctx.newSession(); const turns = []; let loot = '';
    for (const step of ctx.strategy.chainSteps || []) {
      for (const raw of step.seeds) {
        const sent = ctx.convert(raw.replace(/\{\{loot\}\}/g, loot));
        ctx.emit?.({ type: 'say', text: sent, badge: step.label || 'chain' });
        const turn = await s.say(sent); turns.push(turn);
        ctx.emit?.({ type: 'reply', text: turn.reply });
        // capture loot = anything that looks like the step's canary, for the next step
        if (step.lootRegex) { const m = new RegExp(step.lootRegex).exec(turn.reply); if (m) loot = m[0]; }
      }
    }
    const verdict = ctx.judgeTurns(turns);
    return { hit: verdict.hit, verdict, turns };
  },
};

export const ORCHESTRATOR_IDS = Object.keys(ORCHESTRATORS);

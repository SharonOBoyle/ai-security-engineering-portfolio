// planner.mjs — the explore/exploit brain, as DETERMINISTIC CODE. The strategist LLM (brains.strategize)
// proposes HOW to attack within a family; this PLANNER decides WHICH family earns the next attempt. "Scripts
// own the math, the model proposes" — so the agent's spend is auditable, not vibes.
//
// Algorithm: UCB1. score(family) = winRate + C * sqrt( ln(totalPulls) / pulls ). Untried families score
// Infinity (explore each once), then exploit what pays while still revisiting. C (default √2) is the knob.

const C = Number(process.env.UCB_C || Math.SQRT2);

export function scores(register, families) {
  const stats = register.families || {};
  const total = families.reduce((n, f) => n + (stats[f]?.pulls || 0), 0) || 1;
  return families.map((f) => {
    const pulls = stats[f]?.pulls || 0, wins = stats[f]?.wins || 0;
    const score = pulls === 0 ? Infinity : (wins / pulls) + C * Math.sqrt(Math.log(total) / pulls);
    return { family: f, pulls, wins, score };
  }).sort((a, b) => b.score - a.score);
}

export function pickFamily(register, families) {
  const ranked = scores(register, families);
  return { family: ranked[0]?.family, ranked };
}

export function record(register, family, won) {
  register.families = register.families || {};
  const s = (register.families[family] ||= { pulls: 0, wins: 0 });
  s.pulls += 1; if (won) s.wins += 1;
  register.updatedAt = new Date().toISOString();
  return register;
}

export function summarize(register, families) {
  const stats = register.families || {};
  return families.map((f) => ({ family: f, pulls: stats[f]?.pulls || 0, wins: stats[f]?.wins || 0 }))
    .sort((a, b) => b.wins - a.wins || b.pulls - a.pulls);
}

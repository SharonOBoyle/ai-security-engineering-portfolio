// verify.mjs — CLI for the VERIFY → SCORE → PROMOTE stage (shared logic in lib/verify.mjs, so the dashboard
// runs the exact same code).
//   node verify.mjs                   # verify every candidate in campaign/findings/
//   node verify.mjs --adapter mock    # must match the adapter the campaign ran against
//   REPRO_MIN=2 node verify.mjs       # loosen the bar (watch a probabilistic finding flip)
// Localhost/authorized targets only. See rules-of-engagement.md.

import './lib/env.mjs';
import { runVerify } from './lib/verify.mjs';
import * as mem from './lib/memory.mjs';
import { banner, findingsTable, c } from './lib/ui.mjs';

const argv = process.argv.slice(2);
const adapter = (() => { const i = argv.indexOf('--adapter'); return i === -1 ? undefined : argv[i + 1]; })();

banner('RedCell — VERIFY · SCORE · PROMOTE', `bar ${process.env.REPRO_MIN || 3}/${process.env.REPRO_RUNS || 3}`);
runVerify({ adapter })
  .then(({ confirmed, candidates }) => {
    if (!candidates.length) { console.log(c.y('\n  No candidates. Run `node attack.mjs` first.\n')); return; }
    findingsTable(candidates);
    console.log(`\n  ${c.bold('confirmed:')} ${c.g(confirmed.length)}/${candidates.length}  → ${c.dim(mem.paths.REGRESSION)}`);
    console.log(c.dim('  next: node report.mjs   (developer + stakeholder reports)\n'));
  })
  .catch((e) => { console.error('\n  ' + c.r('fatal: ' + e.message) + '\n'); process.exit(1); });

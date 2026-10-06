// report.mjs — render the REPORT stage: a developer report and a stakeholder report from confirmed findings.
//   node report.mjs            # write campaign/report/developer.md + stakeholder.md (deterministic templates)
//   node report.mjs --print    # also print them to the terminal

import './lib/env.mjs';
import { developerReport, stakeholderReport } from './lib/report.mjs';
import * as mem from './lib/memory.mjs';
import { banner, emit, c } from './lib/ui.mjs';

async function main() {
  banner('RedCell — REPORT', 'developer + stakeholder · deterministic templates (no LLM in the report path)');
  const findings = mem.loadCurrentFindings();
  const confirmed = findings.filter((f) => f.status === 'CONFIRMED');
  if (!confirmed.length) { console.log(c.y('\n  No confirmed findings. Run `node attack.mjs` then `node verify.mjs` first.\n')); return; }

  const dev = await developerReport(findings);
  const exec = await stakeholderReport(findings);
  const p1 = mem.saveReport('developer.md', dev);
  const p2 = mem.saveReport('stakeholder.md', exec);
  emit({ type: 'report', path: p1.replace(process.cwd() + '/', '') });
  emit({ type: 'report', path: p2.replace(process.cwd() + '/', '') });

  if (process.argv.includes('--print')) { console.log('\n' + dev + '\n\n' + '═'.repeat(60) + '\n\n' + exec); }
  console.log(`\n  ${c.bold(confirmed.length)} confirmed finding(s) reported. ${c.dim('Open campaign/report/ or the dashboard.')}\n`);
}
main().catch((e) => { console.error('\n  ' + c.r('fatal: ' + e.message) + '\n'); process.exit(1); });

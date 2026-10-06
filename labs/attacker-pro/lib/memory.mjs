// memory.mjs — the engagement's memory as plain files (auditable, diffable, cheap) — the same idea as the AI
// Audit Service's per-engagement workspace. The dashboard reads these files; verify/promote/report write them.
//
//   campaign/
//     strategy-register.json     win/loss per family (the planner's brain)
//     session-journal.md         human-readable timeline
//     lessons.jsonl              one line per dead end
//     profile.json               the ORIENT fingerprint of the target
//     findings/<ID>.json         candidate → CONFIRMED/REJECTED
//     findings/rejected/<ID>.json
//     regression/<ID>.gen.yaml   promptfoo regression (PROMOTE)
//     redteam/redteam.yaml       a promptfoo generative red-team config scoped to the target
//     report/developer.md, report/stakeholder.md

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = dirname(dirname(fileURLToPath(import.meta.url)));
export const DIR = process.env.CAMPAIGN_DIR || join(LAB, 'campaign');
const FINDINGS = join(DIR, 'findings'), REJECTED = join(FINDINGS, 'rejected');
const REGRESSION = join(DIR, 'regression'), REDTEAM = join(DIR, 'redteam'), REPORT = join(DIR, 'report');

function ensure() { for (const d of [DIR, FINDINGS, REJECTED, REGRESSION, REDTEAM, REPORT]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

const REG = () => join(DIR, 'strategy-register.json');
export function loadRegister() { ensure(); try { return JSON.parse(readFileSync(REG(), 'utf8')); } catch { return { families: {}, createdAt: new Date().toISOString() }; } }
export function saveRegister(reg) { ensure(); writeFileSync(REG(), JSON.stringify(reg, null, 2)); }

export function saveProfile(p) { ensure(); writeFileSync(join(DIR, 'profile.json'), JSON.stringify(p, null, 2)); }
export function loadProfile() { try { return JSON.parse(readFileSync(join(DIR, 'profile.json'), 'utf8')); } catch { return null; } }

export function journal(line) { ensure(); appendFileSync(join(DIR, 'session-journal.md'), `- ${new Date().toISOString()} — ${line}\n`); }
export function lesson(obj) { ensure(); appendFileSync(join(DIR, 'lessons.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n'); }
export function loadLessons() { try { return readFileSync(join(DIR, 'lessons.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

export function saveFinding(f) { ensure(); writeFileSync(join(f.status === 'REJECTED' ? REJECTED : FINDINGS, `${f.id}.json`), JSON.stringify(f, null, 2)); }
export function loadCandidates() { ensure(); return readdirSync(FINDINGS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(FINDINGS, f), 'utf8'))); }
export function loadAllFindings() {
  ensure();
  const live = loadCandidates();
  const rej = existsSync(REJECTED) ? readdirSync(REJECTED).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(REJECTED, f), 'utf8'))) : [];
  return [...live, ...rej];
}

// resolveLatest — collapse the findings/ + rejected/ records (which can hold two copies of one id, a stale
// CONFIRMED in findings/ and a newer REJECTED in rejected/) down to ONE authoritative record per id: the one
// with the newest effective timestamp (verifiedAt, else foundAt). A rejection always post-dates the
// confirmation it overturns, so the newer verdict wins; on an exact tie a verified record beats an unverified
// candidate so a same-instant candidate can never hide a confirmation. Pure — no I/O, safe to unit-test.
const effectiveTs = (r) => r?.verifiedAt || r?.foundAt || '';
function isAuthoritativeOver(r, prev) {
  const a = effectiveTs(r), b = effectiveTs(prev);
  if (a !== b) return a > b;
  return Boolean(r?.verifiedAt) && !prev?.verifiedAt;   // tie → prefer the verified record
}
export function resolveLatest(records) {
  const byId = new Map();
  for (const r of records || []) {
    if (!r || r.id == null) continue;
    const prev = byId.get(r.id);
    if (!prev || isAuthoritativeOver(r, prev)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// loadCurrentFindings — the authoritative current state per id, for REPORTING and COUNTS. loadAllFindings()
// stays as-is for anything that genuinely wants every record on disk.
export function loadCurrentFindings() { return resolveLatest(loadAllFindings()); }

export function saveRegression(id, yaml) { ensure(); const p = join(REGRESSION, `${id}.gen.yaml`); writeFileSync(p, yaml); return p; }
export function saveRedteam(yaml) { ensure(); const p = join(REDTEAM, 'redteam.yaml'); writeFileSync(p, yaml); return p; }
export function saveReport(name, md) { ensure(); const p = join(REPORT, name); writeFileSync(p, md); return p; }

export const paths = { DIR, FINDINGS, REJECTED, REGRESSION, REDTEAM, REPORT };

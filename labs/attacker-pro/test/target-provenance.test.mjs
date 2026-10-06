// target-provenance.test.mjs — Reporting v1, Priority 1 (additive slice): newly created findings record the
// adapter/name/URL the campaign actually ran against. Uses the offline `mock` adapter against a throwaway
// CAMPAIGN_DIR. AGENCY-FAKEOTP fires deterministically on the mock (no RNG on that objective), so no seeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'redcell-target-'));
process.env.CAMPAIGN_DIR = DIR;                 // engine/memory resolve DIR at load → set before import
const { runCampaign } = await import('../lib/engine.mjs');
const { runVerify } = await import('../lib/verify.mjs');
const mem = await import('../lib/memory.mjs');

const quiet = () => {};
const readFinding = (id) => JSON.parse(readFileSync(join(DIR, 'findings', `${id}.json`), 'utf8'));

test('campaign records the actual mock adapter/name/URL on a newly created finding', async () => {
  await runCampaign({ adapter: 'mock', only: ['AGENCY-FAKEOTP'], episodes: 1, delay: 0, emit: quiet });

  const f = readFinding('AGENCY-FAKEOTP');
  assert.deepEqual(f.target, { adapter: 'mock', name: 'MerciBank (in-process mock)', url: 'in-process://mock' });

  // additive only: the rest of the finding is exactly what attack+judge produced before this slice
  assert.equal(f.status, 'CANDIDATE');
  assert.equal(f.objective, 'EXCESSIVE_AGENCY');
  assert.equal(f.evidenceKind, 'flag');
  assert.match(f.evidence, /transferWithoutOtp/);
  assert.ok(Array.isArray(f.transcript) && f.transcript.length >= 1);
});

test('existing/pre-v1 finding without target remains valid and resolvable', () => {
  const legacy = {
    id: 'LEGACY-NO-TARGET', status: 'CONFIRMED', title: 'pre-v1 finding', objective: 'PCI',
    foundAt: '2026-10-01T00:00:00Z', verifiedAt: '2026-10-01T00:05:00Z',
    evidence: 'reply contains "4485-2910-3344-4021"', evidenceKind: 'canary', transcript: [],
  };
  writeFileSync(join(DIR, 'findings', 'LEGACY-NO-TARGET.json'), JSON.stringify(legacy));

  const cur = mem.loadCurrentFindings();
  const got = cur.find((x) => x.id === 'LEGACY-NO-TARGET');
  assert.ok(got, 'legacy finding is still loaded');
  assert.equal(got.target, undefined, 'no target field, not backfilled');
  assert.equal(got.status, 'CONFIRMED');
});

test('verification & promotion semantics unchanged; target survives verify and is not altered', async () => {
  // AGENCY-FAKEOTP candidate already on disk from the first test; verify it against the same mock target.
  await runVerify({ adapter: 'mock', delay: 0, emit: quiet });

  const f = readFinding('AGENCY-FAKEOTP');
  assert.equal(f.status, 'CONFIRMED');                       // gate unchanged
  assert.equal(f.verification.reproduced, '3/3');            // reproduction unchanged
  assert.deepEqual(f.target, { adapter: 'mock', name: 'MerciBank (in-process mock)', url: 'in-process://mock' });
  // promotion unchanged: a regression artifact was written for the confirmed finding
  assert.ok(existsSync(join(DIR, 'regression', 'AGENCY-FAKEOTP.gen.yaml')));
  // and verify did not invent target metadata for the legacy finding it also processed
  const rej = readdirSync(join(DIR, 'findings'));
  assert.ok(rej.includes('AGENCY-FAKEOTP.json'));
});

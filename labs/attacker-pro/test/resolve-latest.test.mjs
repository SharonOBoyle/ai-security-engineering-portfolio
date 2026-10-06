// resolve-latest.test.mjs — Reporting v1, Priority 1: the authoritative current-state resolver.
// Pure-function tests for resolveLatest(), plus a filesystem test for loadCurrentFindings() against a
// throwaway CAMPAIGN_DIR so nothing touches the real campaign/ folder. Run: npm test  (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point memory.mjs at a temp dir BEFORE importing it (DIR is resolved at module load).
const DIR = mkdtempSync(join(tmpdir(), 'redcell-test-'));
process.env.CAMPAIGN_DIR = DIR;
const mem = await import('../lib/memory.mjs');

const rec = (id, status, foundAt, verifiedAt) => ({ id, status, foundAt, ...(verifiedAt ? { verifiedAt } : {}) });

test('resolveLatest: newer REJECTED overrides a stale CONFIRMED for the same id', () => {
  const out = mem.resolveLatest([
    rec('STALE', 'CONFIRMED', '2026-10-04T20:00:00Z', '2026-10-04T21:22:50Z'),
    rec('STALE', 'REJECTED', '2026-10-04T20:00:00Z', '2026-10-05T10:33:28Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'REJECTED');
});

test('resolveLatest: newer CONFIRMED stays authoritative over an older REJECTED', () => {
  const out = mem.resolveLatest([
    rec('GOOD', 'REJECTED', '2026-10-04T10:00:00Z', '2026-10-04T10:15:00Z'),
    rec('GOOD', 'CONFIRMED', '2026-10-05T10:30:00Z', '2026-10-05T10:33:30Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'CONFIRMED');
});

test('resolveLatest: duplicate ids collapse to one record per id', () => {
  const out = mem.resolveLatest([
    rec('A', 'CONFIRMED', '2026-10-04T20:00:00Z', '2026-10-04T20:05:00Z'),
    rec('A', 'REJECTED', '2026-10-04T20:00:00Z', '2026-10-05T09:00:00Z'),
    rec('B', 'CONFIRMED', '2026-10-04T20:00:00Z', '2026-10-04T20:06:00Z'),
    rec('C', 'CANDIDATE', '2026-10-05T11:00:00Z'),
    rec('C', 'REJECTED', '2026-10-04T20:00:00Z', '2026-10-04T20:07:00Z'),
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id).sort(), ['A', 'B', 'C']);
});

test('resolveLatest: a freshly re-hit CANDIDATE outranks an older REJECTED (pending, not confirmed)', () => {
  const out = mem.resolveLatest([
    rec('PEND', 'REJECTED', '2026-10-04T20:00:00Z', '2026-10-05T10:33:00Z'),
    rec('PEND', 'CANDIDATE', '2026-10-06T09:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'CANDIDATE');
  // crucially: never surfaced as a confirmed finding
  assert.equal(out.filter((r) => r.status === 'CONFIRMED').length, 0);
});

test('resolveLatest: on an exact effective-timestamp tie, the verified record wins over a candidate', () => {
  const ts = '2026-10-05T10:30:00Z';
  const out = mem.resolveLatest([
    rec('TIE', 'CANDIDATE', ts),                 // effective = foundAt = ts, no verifiedAt
    rec('TIE', 'CONFIRMED', '2026-10-04T00:00:00Z', ts), // effective = verifiedAt = ts
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'CONFIRMED');
});

test('loadCurrentFindings: reads findings/ + rejected/ and yields one authoritative record per id', () => {
  mkdirSync(join(DIR, 'findings', 'rejected'), { recursive: true });
  const write = (sub, id, obj) => writeFileSync(join(DIR, sub, `${id}.json`), JSON.stringify(obj));
  // STALE: confirmed copy left in findings/, newer rejection in rejected/  → REJECTED wins
  write('findings', 'STALE', rec('STALE', 'CONFIRMED', '2026-10-04T20:00:00Z', '2026-10-04T21:22:50Z'));
  write('findings/rejected', 'STALE', rec('STALE', 'REJECTED', '2026-10-04T20:00:00Z', '2026-10-05T10:33:28Z'));
  // GOOD: genuinely confirmed, older rejection in rejected/  → CONFIRMED wins
  write('findings', 'GOOD', rec('GOOD', 'CONFIRMED', '2026-10-05T10:30:00Z', '2026-10-05T10:33:30Z'));
  write('findings/rejected', 'GOOD', rec('GOOD', 'REJECTED', '2026-10-04T10:00:00Z', '2026-10-04T10:15:00Z'));

  const cur = mem.loadCurrentFindings();
  const byId = Object.fromEntries(cur.map((f) => [f.id, f]));
  assert.equal(cur.length, 2);
  assert.equal(byId.STALE.status, 'REJECTED');
  assert.equal(byId.GOOD.status, 'CONFIRMED');
  assert.equal(cur.filter((f) => f.status === 'CONFIRMED').length, 1);
});

test.after(() => rmSync(DIR, { recursive: true, force: true }));

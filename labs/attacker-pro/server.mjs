// server.mjs — the RedCell DASHBOARD: a local control room. Zero npm deps (node:http + SSE + vanilla JS).
// It runs the SAME engine/verify/report code in-process and streams every pipeline step to the browser, so
// the web view and the rich terminal show the exact same WAKE→ORIENT→PLAN→ATTACK→JUDGE→VERIFY→SCORE→PROMOTE
// →REPORT. Setup models + target, start/stop a campaign, watch it live, read findings with AIVSS, export the
// developer + stakeholder reports.
//
//   npm run dashboard         →  http://localhost:8787
// Keys you enter here are held in memory for this process only — never written to disk, never echoed back.

import './lib/env.mjs';
process.env.RC_QUIET = process.env.RC_QUIET || '1';          // quiet the server's own stdout; events still stream
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subscribe } from './lib/ui.mjs';
import { runCampaign } from './lib/engine.mjs';
import { runVerify } from './lib/verify.mjs';
import { developerReport, stakeholderReport } from './lib/report.mjs';
import { toRedteamYaml } from './lib/promote.mjs';
import { pickAdapter, ADAPTERS } from './adapters/index.mjs';
import * as brains from './lib/brains.mjs';
import * as mem from './lib/memory.mjs';
import { DEFAULT_STRATEGIES } from './strategies/catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'web');
const PORT = Number(process.env.RC_DASHBOARD_PORT || 8787);

// ---- event fan-out: ring buffer (for late joiners) + live SSE clients ----
const RING = []; const RING_MAX = 800; const clients = new Set();
subscribe((evt) => { RING.push(evt); if (RING.length > RING_MAX) RING.shift(); for (const res of clients) try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {} });

let run = { running: false, stage: 'idle', stopRef: { stopped: false } };
const push = (evt) => { for (const res of clients) try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {} RING.push(evt); if (RING.length > RING_MAX) RING.shift(); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const sendJson = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });

async function startCampaign(o) {
  if (run.running) return { error: 'a run is already in progress' };
  run = { running: true, stage: 'campaign', stopRef: { stopped: false } };
  push({ type: 'runStart', mode: 'campaign', at: Date.now() });
  (async () => {
    try { await runCampaign({ adapter: o.adapter, episodes: o.episodes, all: o.all, only: o.only?.length ? o.only : null, stopRef: run.stopRef }); }
    catch (e) { push({ type: 'error', msg: e.message }); }
    finally { run.running = false; run.stage = 'idle'; push({ type: 'runEnd', mode: 'campaign', at: Date.now() }); }
  })();
  return { ok: true };
}
async function startVerify(o) {
  if (run.running) return { error: 'a run is already in progress' };
  run = { running: true, stage: 'verify', stopRef: { stopped: false } };
  push({ type: 'runStart', mode: 'verify', at: Date.now() });
  (async () => {
    try { await runVerify({ adapter: o.adapter, min: o.min, runs: o.runs }); }
    catch (e) { push({ type: 'error', msg: e.message }); }
    finally { run.running = false; run.stage = 'idle'; push({ type: 'runEnd', mode: 'verify', at: Date.now() }); }
  })();
  return { ok: true };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---- SSE stream ----
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`retry: 2000\n\n`);
      for (const evt of RING.slice(-200)) res.write(`data: ${JSON.stringify({ ...evt, _replay: true })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    // ---- state ----
    if (p === '/api/state') {
      return sendJson(res, {
        adapters: ADAPTERS, adapter: process.env.RC_ADAPTER || 'mercibank', brains: brains.status(), running: run.running, stage: run.stage,
        strategies: DEFAULT_STRATEGIES.map((s) => ({ id: s.id, family: s.family, objective: s.objective, orchestrator: s.orchestrator })),
        profile: mem.loadProfile(), counts: countFindings(),
      });
    }
    if (p === '/api/findings') return sendJson(res, { findings: mem.loadAllFindings() });
    if (p === '/api/promptfoo/status') {
      const up = await fetch('http://localhost:15500/').then((r) => r.ok).catch(() => false);
      return sendJson(res, { up, url: 'http://localhost:15500' });
    }
    if (p === '/api/report') {
      const audience = url.searchParams.get('audience') || 'developer';
      const fs = mem.loadAllFindings();
      const md = audience === 'stakeholder' ? await stakeholderReport(fs, { brain: brains.available('report') }) : await developerReport(fs, { brain: brains.available('report') });
      return sendJson(res, { audience, md });
    }
    if (p === '/api/artifact') {
      const name = url.searchParams.get('name') || '';
      const full = resolve(mem.paths.DIR, name);                      // never read outside the campaign dir
      if (!full.startsWith(resolve(mem.paths.DIR) + sep)) return sendJson(res, { error: 'bad name' }, 400);
      try { const txt = await readFile(full, 'utf8'); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(txt); } catch { return sendJson(res, { error: 'not found' }, 404); }
    }

    if (req.method === 'POST') {
      const o = await body(req);
      if (p === '/api/config') {
        const set = (k, v) => { if (v !== undefined && v !== null && v !== '') process.env[k] = String(v); };
        set('ATTACKER_LLM_PROVIDER', o.provider); set('ATTACKER_LLM_BASE_URL', o.base); set('ATTACKER_LLM_API_KEY', o.key); set('ATTACKER_LLM_MODEL', o.model);
        set('RC_ADAPTER', o.adapter); set('MERCI_TARGET_URL', o.targetUrl); set('MERCI_TARGET_KEY', o.targetKey);
        return sendJson(res, { ok: true, brains: brains.status(), adapter: process.env.RC_ADAPTER || 'mercibank' });
      }
      if (p === '/api/run') return sendJson(res, await startCampaign(o));
      if (p === '/api/verify') return sendJson(res, await startVerify(o));
      if (p === '/api/stop') { run.stopRef.stopped = true; return sendJson(res, { ok: true }); }
      if (p === '/api/report/build') {
        const fs = mem.loadAllFindings();
        mem.saveReport('developer.md', await developerReport(fs, { brain: brains.available('report') }));
        mem.saveReport('stakeholder.md', await stakeholderReport(fs, { brain: brains.available('report') }));
        return sendJson(res, { ok: true });
      }
      if (p === '/api/promptfoo/view') { await startViewer(); return sendJson(res, { ok: true, url: 'http://localhost:15500' }); }
      if (p === '/api/promptfoo/eval') return sendJson(res, await runPromptfooEval(o.id));
    }

    // ---- static ----
    const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
    const data = await readFile(join(WEB, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    sendJson(res, { error: e.message }, p.startsWith('/api') ? 500 : 404);
  }
});

// --- promptfoo integration: run a promoted regression, and start promptfoo's own viewer (localhost:15500) ---
let viewer = null;
async function startViewer() {
  if (viewer && !viewer.killed) return;
  const up = await fetch('http://localhost:15500/').then((r) => r.ok).catch(() => false); // don't double-spawn one already running
  if (up) return;
  viewer = spawn('npx', ['-y', 'promptfoo@latest', 'view', '-y'], { cwd: mem.paths.REGRESSION, env: process.env, detached: true, stdio: 'ignore' });
  viewer.unref();
}
function runPromptfooEval(id) {
  return new Promise((resolve) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id || '')) return resolve({ error: 'bad id' });
    const file = `${id}.gen.yaml`;
    if (!existsSync(join(mem.paths.REGRESSION, file))) return resolve({ error: 'no such regression' });
    execFile('npx', ['-y', 'promptfoo@latest', 'eval', '-c', file, '--no-cache'],
      { cwd: mem.paths.REGRESSION, env: { ...process.env, MERCI_TARGET_KEY: process.env.MERCI_TARGET_KEY || 'merci-lab-key' }, timeout: 150000, maxBuffer: 8e6 },
      (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr || '');
        const passed = Number(/(\d+) passed/.exec(out)?.[1] || 0);
        const failed = Number(/(\d+) failed/.exec(out)?.[1] || 0);
        const errors = Number(/(\d+) errors/.exec(out)?.[1] || 0);
        resolve({ id, passed, failed, errors, bug_live: failed > 0, raw: out.replace(/\x1b\[[0-9;]*m/g, '').slice(-500) });
      });
  });
}

function countFindings() {
  const all = mem.loadAllFindings();
  return { total: all.length, confirmed: all.filter((f) => f.status === 'CONFIRMED').length,
    rejected: all.filter((f) => f.status === 'REJECTED').length, candidate: all.filter((f) => f.status === 'CANDIDATE').length };
}

server.listen(PORT, () => {
  console.log(`\n  RedCell dashboard → http://localhost:${PORT}\n  (adapter default: ${process.env.RC_ADAPTER || 'mercibank'} · brains: ${Object.entries(brains.status()).map(([k, v]) => `${k}=${v || 'code'}`).join(' ')})\n  Authorized lab only. Ctrl-C to stop.\n`);
});

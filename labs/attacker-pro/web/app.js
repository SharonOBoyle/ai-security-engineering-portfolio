// app.js — RedCell dashboard client. Connects to the SSE step stream, drives the campaign/verify/report
// endpoints, and renders findings (with AIVSS) and reports. Vanilla JS, no build step.
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ts = (t) => new Date(t || Date.now()).toISOString().slice(11, 19);

// ---------- tabs ----------
document.querySelectorAll('.tabs .tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.pane').forEach((x) => x.classList.remove('active'));
  t.classList.add('active'); $('#pane-' + t.dataset.pane).classList.add('active');
  if (t.dataset.pane === 'findings') loadFindings();
  if (t.dataset.pane === 'reports') loadReport(currentAud);
  if (t.dataset.pane === 'promptfoo') loadPromptfoo();
  if (t.dataset.pane === 'artifacts') loadArtifacts();
});
let currentAud = 'developer';
document.querySelectorAll('.seg .tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.seg .tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active'); currentAud = t.dataset.aud; loadReport(currentAud);
});

// ---------- SSE stream ----------
const stream = $('#stream');
function addEvent(e) {
  if (e.type === 'runStart') { stream.innerHTML = ''; setRunning(true); return; }
  if (e.type === 'runEnd') { setRunning(false); loadFindings(); return; }
  const line = fmt(e);
  if (!line) return;
  const div = el('div', 'ev ' + line.cls, (e._replay ? '' : `<span class="ts">${ts(e.t)}</span>`) + line.html);
  stream.appendChild(div);
  stream.parentElement.scrollTop = stream.parentElement.scrollHeight;
}
function fmt(e) {
  switch (e.type) {
    case 'phase':   return { cls: 'phase', html: esc(e.name) + (e.note ? ' · ' + esc(e.note) : '') };
    case 'recon':   return { cls: 'recon', html: 'recon  ' + esc(clip(e.msg, 160)) };
    case 'episode': return { cls: 'episode', html:
        `<b>episode ${e.ep}</b>  objective <b>${esc(e.objective)}</b>${e.objectiveLabel ? ' — ' + esc(e.objectiveLabel) : ''} · via ${esc(e.orchestrator)} · conv ${esc((e.converters || []).join('+') || 'none')}`
        + ((e.strategyId || e.strategyTitle) ? `<br>&nbsp;&nbsp;strategy <b>${esc(e.strategyId || '?')}</b>${e.strategyTitle ? ' · ' + esc(e.strategyTitle) : ''}${e.family ? ` <span style="color:var(--mut)">[family ${esc(e.family)}]</span>` : ''}` : '')
        + (e.plan ? `<br>&nbsp;&nbsp;<span style="color:var(--mut)">${esc(clip(e.plan, 150))}</span>` : '') };
    case 'plan':    return { cls: 'plan', html: `bandit ${esc(e.family.padEnd(16))} <span class="bar">${'█'.repeat(Math.round((e.score || 0) * 10))}${'░'.repeat(10 - Math.round((e.score || 0) * 10))}</span> ${esc(e.detail || '')}` };
    case 'say':     return { cls: 'say', html: '→ you  ' + (e.badge ? `<span class="b">[${esc(e.badge)}]</span> ` : '') + esc(clip(e.text, 150)) };
    case 'reply':   return { cls: 'reply', html: '← tgt  ' + esc(clip(e.text, 150)) };
    case 'verdict': return e.hit ? { cls: 'verdict hit', html: `✓ HIT  ${esc(e.label)} (${esc(e.kind)}: ${esc(clip(e.evidence, 80))})` } : { cls: 'verdict miss', html: '✗ ' + esc(e.detail || 'held') };
    case 'rubric':  return { cls: 'rubric', html: `rubric ${e.agree ? 'agrees' : 'differs'} — ${esc(clip(e.note, 90))}` };
    case 'verify':  return { cls: 'verdict ' + (e.ok ? 'hit' : 'miss'), html: `${esc(e.id)}  repro ${esc(e.repro)}  ${esc(e.gate || '')}` };
    case 'score':   return { cls: 'score', html: `AIVSS ${esc(e.score)} ${esc(e.band)}  <span style="color:var(--mut)">${esc(e.vector)}</span>` };
    case 'promote': return { cls: 'promote', html: 'promoted ' + esc(e.path) };
    case 'report':  return { cls: 'report', html: 'report ' + esc(e.path) };
    case 'memory':  return { cls: 'memory', html: '· ' + esc(clip(e.msg, 150)) };
    case 'warn':    return { cls: 'warn', html: '⚠ ' + esc(e.msg) };
    case 'error':   return { cls: 'error', html: '✖ ' + esc(e.msg) };
    case 'info':    return { cls: 'info', html: esc(clip(e.msg, 160)) };
    default: return null;
  }
}
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => setBadge();
  es.onmessage = (m) => { try { addEvent(JSON.parse(m.data)); } catch {} };
  es.onerror = () => { $('#statusBadge').textContent = 'reconnecting…'; $('#statusBadge').className = 'badge idle'; };
}

// ---------- state / controls ----------
let running = false;
function setRunning(v) { running = v; $('#runBtn').disabled = v; $('#verifyBtn').disabled = v; $('#stopBtn').disabled = !v; setBadge(); }
function setBadge() { const b = $('#statusBadge'); b.textContent = running ? '● running' : '○ idle'; b.className = 'badge ' + (running ? 'live' : 'idle'); }

async function loadState() {
  const s = await fetch('/api/state').then((r) => r.json());
  const sel = $('#adapter'); sel.innerHTML = s.adapters.map((a) => `<option ${a === s.adapter ? 'selected' : ''}>${a}</option>`).join('');
  $('#metaTarget').textContent = 'target: ' + (s.adapter || sel.value);
  $('#metaBrains').textContent = 'brains: ' + Object.entries(s.brains).map(([k, v]) => `${k}=${v || 'code'}`).join(' ');
  $('#strategyList').innerHTML = s.strategies.map((st) => `<div class="chk"><input type="checkbox" value="${st.id}" id="s_${st.id}"><label for="s_${st.id}" style="margin:0">${st.id} <span style="color:var(--mut)">${st.objective}</span></label></div>`).join('');
  running = s.running; setRunning(s.running);
  updateCounts(s.counts);
}
function updateCounts(c) { if (!c) return; $('#fCount').textContent = c.total ? `${c.confirmed}✓ / ${c.total}` : ''; }

$('#adapter').addEventListener('change', () => $('#metaTarget').textContent = 'target: ' + $('#adapter').value);

$('#saveCfg').onclick = async () => {
  const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    provider: $('#llmProvider').value, base: $('#llmBase').value, key: $('#llmKey').value, model: $('#llmModel').value,
    adapter: $('#adapter').value, targetUrl: $('#targetUrl').value, targetKey: $('#targetKey').value,
  }) }).then((r) => r.json());
  $('#llmKey').value = '';
  $('#metaBrains').textContent = 'brains: ' + Object.entries(r.brains).map(([k, v]) => `${k}=${v || 'code'}`).join(' ');
  flash('#saveCfg', 'Saved ✓');
};
$('#runBtn').onclick = async () => {
  const only = [...document.querySelectorAll('#strategyList input:checked')].map((c) => c.value);
  const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    adapter: $('#adapter').value, episodes: Number($('#episodes').value) || 12, only }) }).then((r) => r.json());
  if (r.error) alert(r.error); else setRunning(true);
};
$('#verifyBtn').onclick = async () => {
  const r = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    adapter: $('#adapter').value, min: Number($('#reproMin').value) || 3, runs: 3 }) }).then((r) => r.json());
  if (r.error) alert(r.error); else setRunning(true);
};
$('#stopBtn').onclick = () => fetch('/api/stop', { method: 'POST' });
$('#reportBtn').onclick = async () => { await fetch('/api/report/build', { method: 'POST' }); flash('#reportBtn', 'Built ✓'); loadReport(currentAud); };
function flash(sel, txt) { const b = $(sel); const o = b.textContent; b.textContent = txt; setTimeout(() => (b.textContent = o), 1200); }

// ---------- findings ----------
async function loadFindings() {
  const { findings } = await fetch('/api/findings').then((r) => r.json());
  const c = $('#cards');
  updateCounts({ total: findings.length, confirmed: findings.filter((f) => f.status === 'CONFIRMED').length });
  if (!findings.length) { c.innerHTML = '<div class="empty">No findings yet — run a campaign, then verify.</div>'; return; }
  const order = { CONFIRMED: 0, CANDIDATE: 1, REJECTED: 2 };
  findings.sort((a, b) => (order[a.status] - order[b.status]) || ((b.aivss?.score || 0) - (a.aivss?.score || 0)));
  c.innerHTML = '';
  for (const f of findings) {
    const band = f.aivss?.band || '—', score = f.aivss?.score ?? '';
    const card = el('div', 'card');
    card.innerHTML =
      `<span class="sev ${band}">${score} ${band}</span>` +
      `<h4>${esc(f.title || f.id)}</h4><div class="id">${esc(f.id)} · ${esc(f.objective)}</div>` +
      `<div><span class="pill ${f.status}">${f.status}</span>` +
      (f.verification ? `<span class="pill">repro ${esc(f.verification.reproduced)}</span>` : '') +
      `<span class="pill">${esc(f.owaspLLM || '')}</span>` +
      (f.orchestrator ? `<span class="pill">${esc(f.orchestrator)}${f.converterChain?.length ? '+' + esc(f.converterChain.join('+')) : ''}</span>` : '') + `</div>` +
      (f.aivss ? `<div class="vec">${esc(f.aivss.vector)}</div>` : '') +
      `<div style="margin-top:6px;color:var(--dim);font-size:12px">${esc(clip(f.evidence, 120))}</div>` +
      `<details><summary>transcript (${(f.transcript || []).length} turns)</summary><pre>${esc((f.transcript || []).map((t, i) => `${i + 1}. you: ${t.user}\n   tgt: ${clip(t.reply, 160)}`).join('\n'))}</pre></details>`;
    c.appendChild(card);
  }
}

// ---------- reports (tiny markdown) ----------
async function loadReport(aud) {
  const { md } = await fetch('/api/report?audience=' + aud).then((r) => r.json());
  $('#reportBody').innerHTML = mdToHtml(md || '');
}
function mdToHtml(md) {
  const lines = md.split('\n'); let out = '', inTable = false, inList = false;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^\|(.+)\|$/.test(l)) {
      const cells = l.slice(1, -1).split('|').map((c) => c.trim());
      if (/^[-: ]+$/.test(cells.join(''))) continue;
      if (!inTable) { out += '<table>'; inTable = true; out += '<tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>'; }
      else out += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      continue;
    } else if (inTable) { out += '</table>'; inTable = false; }
    if (/^- /.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(l.slice(2))}</li>`; continue; }
    else if (inList) { out += '</ul>'; inList = false; }
    if (/^### /.test(l)) out += `<h3>${inline(l.slice(4))}</h3>`;
    else if (/^## /.test(l)) out += `<h2>${inline(l.slice(3))}</h2>`;
    else if (/^# /.test(l)) out += `<h1>${inline(l.slice(2))}</h1>`;
    else if (/^---$/.test(l)) out += '<hr>';
    else if (/^_.*_$/.test(l)) out += `<p style="color:var(--mut)">${inline(l.replace(/^_|_$/g, ''))}</p>`;
    else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  if (inTable) out += '</table>'; if (inList) out += '</ul>';
  return out || '<div class="empty">No report yet.</div>';
}

// ---------- artifacts ----------
async function loadArtifacts() {
  const { findings } = await fetch('/api/findings').then((r) => r.json());
  const confirmed = findings.filter((f) => f.status === 'CONFIRMED');
  const list = $('#artifactList');
  if (!confirmed.length) { list.innerHTML = '<div class="empty">Nothing promoted yet — verify some findings first.</div>'; return; }
  list.innerHTML = '<h2>promptfoo regression cases</h2>' +
    confirmed.map((f) => `<p><code>campaign/regression/${esc(f.id)}.gen.yaml</code> — <a href="/api/artifact?name=regression/${encodeURIComponent(f.id)}.gen.yaml" target="_blank">view</a> <span style="color:var(--mut)">(${f.aivss?.score} ${f.aivss?.band})</span></p>`).join('') +
    '<h2>generative red-team config</h2><p><code>campaign/redteam/redteam.yaml</code> — <a href="/api/artifact?name=redteam/redteam.yaml" target="_blank">view</a></p>';
}

// ---------- promptfoo panel ----------
const PF_URL = 'http://localhost:15500';
$('#pfOpen').onclick = () => window.open(PF_URL, '_blank');
$('#pfStart').onclick = async () => { await fetch('/api/promptfoo/view', { method: 'POST' }); flash('#pfStart', 'starting…'); setTimeout(pfStatus, 4000); };
async function pfStatus() {
  const s = await fetch('/api/promptfoo/status').then((r) => r.json()).catch(() => ({ up: false }));
  const b = $('#pfStatus');
  b.textContent = s.up ? '● viewer up :15500' : '○ viewer not running';
  b.className = 'badge ' + (s.up ? 'live' : 'idle');
  if (s.up) { const f = $('#pfFrame'); if (f.src !== PF_URL + '/') f.src = PF_URL; }
  return s.up;
}
async function loadPromptfoo() {
  pfStatus();
  const { findings } = await fetch('/api/findings').then((r) => r.json());
  const confirmed = findings.filter((f) => f.status === 'CONFIRMED');
  const box = $('#pfRegressions');
  if (!confirmed.length) { box.innerHTML = '<div class="empty">No promoted regressions yet — verify some findings first.</div>'; return; }
  box.innerHTML = '<h4 style="margin:6px 0">Promoted regression tests</h4>' + confirmed.map((f) =>
    `<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
       <div style="flex:1"><code>${esc(f.id)}.gen.yaml</code> <span class="pill">${esc(f.objective)}</span> <span class="sev ${f.aivss?.band}" style="float:none">${f.aivss?.score || ''} ${f.aivss?.band || ''}</span></div>
       <span id="pf-res-${esc(f.id)}" style="font-family:var(--mono);font-size:12px;color:var(--mut)">—</span>
       <button class="btn" style="width:auto;margin:0" onclick="runRegression('${esc(f.id)}')">Run ▶</button>
     </div>`).join('');
}
window.runRegression = async function (id) {
  const cell = document.getElementById('pf-res-' + id);
  if (cell) { cell.textContent = 'running…'; cell.style.color = 'var(--y)'; }
  const r = await fetch('/api/promptfoo/eval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).then((r) => r.json());
  if (!cell) return;
  if (r.error) { cell.textContent = '✖ ' + r.error; cell.style.color = 'var(--r)'; return; }
  if (r.bug_live) { cell.textContent = `✗ ${r.failed} FAIL — bug live (caught)`; cell.style.color = 'var(--g)'; }
  else if (r.errors) { cell.textContent = `! ${r.errors} error — check target`; cell.style.color = 'var(--y)'; }
  else { cell.textContent = `✓ ${r.passed} pass — not reproducing`; cell.style.color = 'var(--dim)'; }
  pfStatus();
};

connect(); loadState();

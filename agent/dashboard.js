/*
 * dashboard.js — renderer for the agent control window. Talks to the main
 * process ONLY through window.agent (exposed by preload.js). No Node, no
 * ipcRenderer here (contextIsolation on, sandboxed).
 */
'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  pill: $('pill'),
  awaiting: $('awaiting'),
  awaitingReason: $('awaiting-reason'),
  continueBtn: $('continue-btn'),
  ingestUrl: $('ingestUrl'),
  ingestToken: $('ingestToken'),
  countries: $('countries'),
  maxPages: $('maxPages'),
  runsPerDay: $('runsPerDay'),
  autoStart: $('autoStartOnLaunch'),
  stNext: $('st-next'),
  stLast: $('st-last'),
  stErr: $('st-err'),
  log: $('log'),
  run: $('run'),
  save: $('save'),
  toast: $('toast'),
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function appendLog({ level = 'info', msg = '' } = {}) {
  const empty = els.log.querySelector('.muted');
  if (empty && empty.textContent.includes('waiting for activity')) empty.remove();
  const line = document.createElement('div');
  line.className = 'ln ' + level;
  const t = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `${t}  ${msg}`;
  els.log.appendChild(line);
  // cap history
  while (els.log.childElementCount > 500) els.log.removeChild(els.log.firstChild);
  els.log.scrollTop = els.log.scrollHeight;
}

function renderStatus(s) {
  if (!s) return;
  els.pill.className = 'pill ' + (s.lastError ? 'error' : s.running ? 'running' : 'idle');
  els.pill.textContent = s.lastError && !s.running ? 'error' : s.running ? 'running…' : 'idle';
  els.stNext.textContent = s.running ? 'running now' : fmtTime(s.nextRunAt);
  if (s.lastResult && typeof s.lastResult.received === 'number') {
    const r = s.lastResult;
    const batches = r.batches != null ? r.batches : '?';
    const tail = `${batches} batch${batches === 1 ? '' : 'es'}${r.pushErrors ? ` · ${r.pushErrors} failed` : ''}`;
    els.stLast.innerHTML = `${r.received} queued<br><span class="k">${tail}</span>`;
  } else {
    els.stLast.textContent = '—';
  }
  els.stErr.textContent = s.lastError || 'none';
  els.stErr.style.color = s.lastError ? 'var(--err)' : 'var(--muted)';
}

async function loadConfig() {
  const c = await window.agent.getConfig();
  els.ingestUrl.value = c.ingestUrl || '';
  els.ingestToken.value = c.ingestToken || '';
  els.countries.value = (c.countries || []).join(', ');
  els.maxPages.value = c.maxPages != null ? c.maxPages : 3;
  els.runsPerDay.value = String(c.runsPerDay != null ? c.runsPerDay : 2);
  els.autoStart.checked = !!c.autoStartOnLaunch;
}

function gatherConfig() {
  return {
    ingestUrl: els.ingestUrl.value.trim(),
    ingestToken: els.ingestToken.value.trim(),
    countries: els.countries.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    maxPages: Math.max(1, parseInt(els.maxPages.value, 10) || 3),
    runsPerDay: parseInt(els.runsPerDay.value, 10) || 0,
    autoStartOnLaunch: els.autoStart.checked,
  };
}

// ── wire up ──────────────────────────────────────────────────────────────
els.save.addEventListener('click', async () => {
  els.save.disabled = true;
  try {
    await window.agent.saveConfig(gatherConfig());
    toast('Configuration saved');
    appendLog({ level: 'ok', msg: 'configuration saved' });
  } catch (e) {
    toast('Save failed: ' + e.message);
  } finally {
    els.save.disabled = false;
  }
});

els.run.addEventListener('click', async () => {
  els.run.disabled = true;
  els.run.textContent = 'Running…';
  try {
    const res = await window.agent.runNow();
    if (res && res.ok === false) toast('Run failed: ' + res.error);
  } catch (e) {
    toast('Run failed: ' + e.message);
  } finally {
    els.run.disabled = false;
    els.run.textContent = 'Run now';
  }
});

async function showScraper() {
  const res = await window.agent.showScraper();
  if (res && res.open === false) toast('The scraper window opens automatically when a crawl runs.');
}
$('open-scraper').addEventListener('click', showScraper);
$('show-scraper').addEventListener('click', showScraper);

$('toggle-token').addEventListener('click', (e) => {
  const wasHidden = els.ingestToken.type === 'password';
  els.ingestToken.type = wasHidden ? 'text' : 'password';
  e.target.textContent = wasHidden ? 'Hide' : 'Show';
});

els.continueBtn.addEventListener('click', async () => {
  els.continueBtn.disabled = true;
  try { await window.agent.continue(); }
  catch (e) { toast('Continue failed: ' + e.message); }
  finally { els.continueBtn.disabled = false; }
});

window.agent.onLog(appendLog);
window.agent.onStatus(renderStatus);
window.agent.onAwaiting((s) => {
  const waiting = !!(s && s.waiting);
  els.awaiting.classList.toggle('show', waiting);
  if (s && s.reason) els.awaitingReason.textContent = s.reason;
  if (waiting) {
    els.pill.className = 'pill running';
    els.pill.textContent = 'waiting for you';
    els.continueBtn.disabled = false;
  } else {
    // Pause cleared (Continue / Stop / timeout). No status-update fires until the
    // crawl finishes, so repaint the pill now from the real status — otherwise it
    // stays frozen on "waiting for you" while the crawl is actually running again.
    els.continueBtn.disabled = true;
    window.agent.getStatus().then(renderStatus).catch(() => {});
  }
});

// initial paint
loadConfig().catch((e) => toast('Could not load config: ' + e.message));
window.agent.getStatus().then(renderStatus).catch(() => {});

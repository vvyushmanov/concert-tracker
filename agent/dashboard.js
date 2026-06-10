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
  loginEmail: $('loginEmail'),
  loginPassword: $('loginPassword'),
  autofillLogin: $('autofillLogin'),
  countries: $('countries'),
  maxPages: $('maxPages'),
  runsPerDay: $('runsPerDay'),
  autoStart: $('autoStartOnLaunch'),
  stNext: $('st-next'),
  stLast: $('st-last'),
  stErr: $('st-err'),
  log: $('log'),
  run: $('run'),
  openScraper: $('open-scraper'),
  save: $('save'),
  toast: $('toast'),
};

let isRunning = false; // mirrors scheduler state; drives the Run/Stop toggle

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

  // Run ⇄ Stop: while a crawl runs, the primary button stops it instead.
  isRunning = !!s.running;
  els.run.textContent = isRunning ? 'Stop crawl ■' : 'Run now';
  els.run.classList.toggle('primary', !isRunning);
  els.run.classList.toggle('danger', isRunning);

  // Show ⇄ Hide scraper window, reflecting its real visibility.
  els.openScraper.textContent = s.scraperVisible ? 'Hide scraper window' : 'Show scraper window';
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
  els.loginEmail.value = c.loginEmail || '';
  els.loginPassword.value = c.loginPassword || '';
  els.autofillLogin.checked = c.autofillLogin !== false;
  els.countries.value = (c.countries || []).join(', ');
  els.maxPages.value = c.maxPages != null ? c.maxPages : 3;
  els.runsPerDay.value = String(c.runsPerDay != null ? c.runsPerDay : 2);
  els.autoStart.checked = !!c.autoStartOnLaunch;
}

function gatherConfig() {
  return {
    ingestUrl: els.ingestUrl.value.trim(),
    ingestToken: els.ingestToken.value.trim(),
    loginEmail: els.loginEmail.value.trim(),
    loginPassword: els.loginPassword.value,
    autofillLogin: els.autofillLogin.checked,
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

// Single button: Stop the crawl while running, otherwise start one. We do NOT
// await runNow() (it resolves only when the whole crawl finishes) — status-updates
// flip the label to "Stop crawl" and back, keeping the button live throughout.
els.run.addEventListener('click', () => {
  if (isRunning) {
    window.agent.stop().then((r) => {
      if (r && r.ok === false) toast(r.error || 'Nothing to stop');
    }).catch((e) => toast('Stop failed: ' + e.message));
  } else {
    window.agent.runNow().then((res) => {
      if (res && res.ok === false) toast('Run failed: ' + res.error);
    }).catch((e) => toast('Run failed: ' + e.message));
  }
});

// Footer button: toggle the scraper window's visibility (it lives only while/after
// a crawl has opened it). renderStatus keeps the label in sync with reality.
els.openScraper.addEventListener('click', async () => {
  try {
    const res = await window.agent.toggleScraper();
    if (res && res.exists === false) {
      toast('The scraper window opens automatically when a crawl runs.');
    } else if (res) {
      els.openScraper.textContent = res.visible ? 'Hide scraper window' : 'Show scraper window';
    }
  } catch (e) {
    toast('Could not toggle the scraper window: ' + e.message);
  }
});

// Banner link: always SHOW the scraper window (so a pending challenge is reachable).
$('show-scraper').addEventListener('click', async () => {
  const res = await window.agent.showScraper();
  if (res && res.exists === false) toast('The scraper window opens automatically when a crawl runs.');
});

$('toggle-token').addEventListener('click', (e) => {
  const wasHidden = els.ingestToken.type === 'password';
  els.ingestToken.type = wasHidden ? 'text' : 'password';
  e.target.textContent = wasHidden ? 'Hide' : 'Show';
});

$('toggle-loginPassword').addEventListener('click', (e) => {
  const wasHidden = els.loginPassword.type === 'password';
  els.loginPassword.type = wasHidden ? 'text' : 'password';
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

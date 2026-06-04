/*
 * main.js — Electron lifecycle + wiring for the concerts-metal scraper agent.
 *
 * Two windows:
 *   • dashboard  — control/status UI (config, live log, Run now). preload + IPC,
 *                  contextIsolation on, nodeIntegration off, sandboxed.
 *   • scraper    — the real visible Chromium that crawls concerts-metal with the
 *                  persistent profile; created lazily on the first crawl and
 *                  surfaced when a Turnstile needs a human.
 * Modules: config + scraper + ingestClient + scheduler + interference bus.
 *
 * ┌─ CRITICAL — DO NOT CHANGE ───────────────────────────────────────────────┐
 * │ The scraper window's webPreferences.partition MUST stay 'persist:cm', and │
 * │ the app name (below) MUST stay pinned. Electron derives userData (where    │
 * │ the persistent profile + Cloudflare clearance live) from the app name;     │
 * │ renaming either relocates/abandons the warmed profile. Keep both forever.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Run:
 *   cd agent
 *   CM_INGEST_TOKEN=<token> CM_INGEST_URL=http://localhost:3000/api/ingest npm start
 *   CM_RUN_ONCE=1 ... npm start     # headless: crawl once, push, then quit
 *   CM_AUTOSTART=0 ... npm start    # open the dashboard WITHOUT a launch crawl
 *   CM_COUNTRY=ge ... npm start     # single country
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const scraper = require('./scraper');
const ingest = require('./ingestClient');
const { createScheduler } = require('./scheduler');
const bus = require('./interference');

// Pin the app name → stable userData → stable 'persist:cm' profile. (See header.)
app.setName('concerts-metal-browser-poc');

let scrapeWin = null;
let dashWin = null;
let scheduler = null;
let cfg = null;
let lastError = null;

// ── manual "Continue" gate ───────────────────────────────────────────────────
// When a crawl is redirected to a challenge / sign-in / register page, the agent
// PAUSES and hands the (full-navigation) scraper window to the user. It resumes
// only when the user clicks Continue in the dashboard (or after a long timeout).
let awaitContinue = null; // resolver while paused
let awaitTimer = null;

function requestContinue(reason, timeoutMs = 900000) {
  // If somehow already waiting, release the previous one.
  if (awaitContinue) resolveContinue('superseded');
  return new Promise((resolve) => {
    awaitContinue = resolve;
    sendToDash('agent:awaiting', { waiting: true, reason });
    if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); }
    awaitTimer = setTimeout(() => {
      if (awaitContinue) { awaitContinue = null; sendToDash('agent:awaiting', { waiting: false }); resolve('timeout'); }
    }, timeoutMs);
  });
}

function resolveContinue(how) {
  if (!awaitContinue) return false;
  if (awaitTimer) clearTimeout(awaitTimer);
  const r = awaitContinue;
  awaitContinue = null;
  sendToDash('agent:awaiting', { waiting: false });
  r(how);
  return true;
}

// ── windows ────────────────────────────────────────────────────────────────
function createScrapeWindow() {
  scrapeWin = new BrowserWindow({
    width: 1280,
    height: 950,
    show: true,
    title: 'Scraper — concerts-metal.com',
    // ⚠️ The persistent profile is the antibot bypass — never change this.
    webPreferences: { partition: 'persist:cm' },
  });
  const wc = scrapeWin.webContents;

  // NOTE: this window is deliberately a FULL browser — the user drives it by hand
  // to solve Turnstile, register, and log in (which navigate freely, sometimes to
  // other hosts / popups). So we do NOT restrict navigation or window.open here.
  // It's the user's own trusted browsing surface; the pause/Continue flow (below)
  // hands control to them when interference is needed.

  // Surface (and recover from) a crashed/hung remote renderer.
  wc.on('render-process-gone', (_e, details) => {
    bus.emit('error', new Error('scraper renderer gone: ' + (details && details.reason)));
    try { if (scrapeWin && !scrapeWin.isDestroyed()) scrapeWin.destroy(); } catch { /* noop */ }
  });
  wc.on('unresponsive', () => bus.emit('error', new Error('scraper window unresponsive')));

  scrapeWin.on('closed', () => { scrapeWin = null; });
  return scrapeWin;
}

function ensureScrapeWindow() {
  if (!scrapeWin || scrapeWin.isDestroyed()) createScrapeWindow();
  return scrapeWin;
}

function createDashboardWindow() {
  dashWin = new BrowserWindow({
    width: 900,
    height: 760,
    show: true,
    title: 'Concerts-Metal Scraper Agent',
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  dashWin.setMenuBarVisibility(false);
  dashWin.loadFile(path.join(__dirname, 'dashboard.html'));
  dashWin.on('closed', () => { dashWin = null; });
  return dashWin;
}

function sendToDash(channel, payload) {
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send(channel, payload);
}

function buildStatus() {
  return {
    running: scheduler ? scheduler.isRunning() : false,
    nextRunAt: scheduler && cfg && cfg.runsPerDay > 0 && scheduler.nextRunTime
      ? scheduler.nextRunTime.toISOString() : null,
    lastResult: scheduler ? scheduler.lastResult : null,
    lastError,
  };
}

// ── one crawl + push cycle ──────────────────────────────────────────────────
async function runScrapeAndPush() {
  lastError = null;
  const win = ensureScrapeWindow();
  bus.emit('progress', `crawl start: ${cfg.countries.join(',')} (≤${cfg.maxPages} pages each)`);

  const concerts = await scraper.crawl(win, cfg, {
    onChallenge: () => bus.emit('challenge'),
    onProgress: (m) => bus.emit('progress', m),
    // Pause the crawl and wait for the user to act in the scraper window.
    waitForContinue: (reason) => requestContinue(reason),
  });

  // Local debug dump.
  try {
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'last-run.json'), JSON.stringify(concerts, null, 2));
  } catch (e) {
    bus.emit('progress', 'could not write debug dump: ' + e.message);
  }

  if (concerts.length === 0) {
    bus.emit('done', { received: 0 });
    return { received: 0 };
  }

  bus.emit('progress', `pushing ${concerts.length} concerts → ${cfg.ingestUrl} …`);
  const stats = await ingest.postConcerts(concerts, { url: cfg.ingestUrl, token: cfg.ingestToken });
  bus.emit('pushed', stats);
  bus.emit('done', { received: concerts.length, stats });
  return { received: concerts.length, stats };
}

// ── lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  cfg = config.load();
  if (!cfg.ingestToken) {
    console.warn('[agent] WARNING: ingestToken not set (CM_INGEST_TOKEN or in the dashboard) — pushes will fail.');
  }
  createDashboardWindow();

  // interference bus → console + dashboard
  bus.on('progress', (m) => { console.log('[agent]', m); sendToDash('agent:log', { level: 'info', msg: m }); });
  bus.on('pushed', (s) => {
    console.log('[agent] ✅ ingested →', JSON.stringify(s));
    sendToDash('agent:log', { level: 'ok', msg: 'ingested → ' + JSON.stringify(s) });
  });
  bus.on('done', () => { sendToDash('agent:challenge', false); sendToDash('agent:status-update', buildStatus()); });
  bus.on('challenge', () => {
    sendToDash('agent:log', { level: 'warn', msg: 'Turnstile detected — solve it in the scraper window' });
    sendToDash('agent:challenge', true);
    if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); }
  });
  bus.on('error', (e) => {
    lastError = e && e.message ? e.message : String(e);
    console.error('[agent] ❌', lastError);
    sendToDash('agent:log', { level: 'error', msg: lastError });
    sendToDash('agent:status-update', buildStatus());
  });

  scheduler = createScheduler({
    runsPerDay: cfg.runsPerDay,
    anchorHour: cfg.anchorHour,
    jitterMinutes: cfg.jitterMinutes,
    runJob: runScrapeAndPush,
    log: (m) => bus.emit('progress', m),
  });

  // ── IPC (dashboard ↔ main) ──────────────────────────────────────────────
  ipcMain.handle('config:get', () => config.load());
  ipcMain.handle('config:save', (_e, partial) => {
    const merged = config.save(partial || {});
    cfg = config.load();
    // Re-arm the schedule to reflect any cadence change.
    scheduler.stop();
    if (cfg.runsPerDay > 0) scheduler.start();
    sendToDash('agent:status-update', buildStatus());
    return merged;
  });
  ipcMain.handle('agent:status', () => buildStatus());
  ipcMain.handle('agent:runNow', async () => {
    sendToDash('agent:status-update', { ...buildStatus(), running: true });
    try {
      const result = await scheduler.runNow();
      sendToDash('agent:status-update', buildStatus());
      return { ok: true, result };
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      sendToDash('agent:status-update', buildStatus());
      return { ok: false, error: lastError };
    }
  });
  // Only surface the scraper window if it already exists (during a crawl).
  // Creating a blank one on demand makes a hard-to-close empty window (esp.
  // under WSLg software rendering); the window opens automatically on a crawl.
  ipcMain.handle('agent:showScraper', () => {
    if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); return { open: true }; }
    return { open: false };
  });
  // User clicked "Continue" after handling a challenge / sign-in in the window.
  ipcMain.handle('agent:continue', () => ({ ok: resolveContinue('manual') }));

  // Runtime flags (always honored, independent of saved config):
  //   CM_RUN_ONCE  → crawl once then quit (headless test)
  //   CM_AUTOSTART=0 → open the dashboard WITHOUT a launch crawl (dev)
  const launchCrawl = !!process.env.CM_RUN_ONCE ||
    (cfg.autoStartOnLaunch && process.env.CM_AUTOSTART !== '0');
  if (launchCrawl) {
    setTimeout(() => {
      scheduler.runNow()
        .catch((e) => bus.emit('error', e))
        .finally(() => { if (process.env.CM_RUN_ONCE) { console.log('[agent] CM_RUN_ONCE — quitting'); app.quit(); } });
    }, 3000);
  }

  // Scheduled cadence runs only when enabled (runsPerDay > 0) and not headless.
  if (!process.env.CM_RUN_ONCE && cfg.runsPerDay > 0) scheduler.start();
});

app.on('window-all-closed', () => app.quit());

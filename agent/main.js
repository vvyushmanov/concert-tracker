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
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const scraper = require('./scraper');
const ingest = require('./ingestClient');
const { createScheduler } = require('./scheduler');
const bus = require('./interference');

// Pin the app name → stable userData → stable 'persist:cm' profile. (See header.)
app.setName('concerts-metal-browser-poc');

// Single-instance: a second launch must NOT spin up a rival process against the
// same userData — that profile-lock collision can leave the new window unmapped.
// Instead the second launch exits and the already-running instance surfaces.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
app.on('second-instance', () => showDashboard());

let scrapeWin = null;
let dashWin = null;
let scheduler = null;
let cfg = null;
let lastError = null;
let tray = null;
let isQuitting = false; // true once a real quit is in progress (vs. minimize-to-tray)
let crawlAborted = false; // set when the user picks "Stop this crawl" at a pause

// Linux system trays (especially under WSLg) are unreliable, so only turn the
// dashboard's close button into "minimize to tray" where the tray is
// dependable. Elsewhere the tray is a bonus menu and closing the window exits
// (so we never strand the user with an unrecoverable hidden window).
const HIDE_ON_CLOSE = process.platform !== 'linux';

// ── manual "Continue" gate ───────────────────────────────────────────────────
// When a crawl is redirected to a challenge / sign-in / register page, the agent
// PAUSES and hands the (full-navigation) scraper window to the user. It resumes
// only when the user clicks Continue in the dashboard (or after a long timeout).
let awaitContinue = null; // resolver while paused
let awaitTimer = null;
let pauseToken = 0; // bumped per pause so a stale dialog's click is ignored

function requestContinue(reason, timeoutMs = 900000) {
  // If somehow already waiting, release the previous one.
  if (awaitContinue) resolveContinue('superseded');
  pauseToken += 1;
  return new Promise((resolve) => {
    awaitContinue = resolve;
    sendToDash('agent:awaiting', { waiting: true, reason });
    updateTray();
    if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); }
    sendToDash('agent:status-update', buildStatus()); // scraper now visible → refresh Show/Hide label
    showPauseDialog(reason);
    awaitTimer = setTimeout(() => {
      if (awaitContinue) { awaitContinue = null; sendToDash('agent:awaiting', { waiting: false }); updateTray(); resolve('timeout'); }
    }, timeoutMs);
  });
}

// A floating, always-reachable prompt shown on every pause so Continue isn't
// buried behind the scraper window. Parentless → it does not block the scraper
// window the user must interact with. The dashboard banner remains a secondary
// path; resolveContinue() is idempotent, so whichever the user clicks wins.
function showPauseDialog(reason) {
  const myToken = pauseToken;
  dialog.showMessageBox({
    type: 'warning',
    noLink: true,
    buttons: ['Continue ▸', 'Stop this crawl'],
    defaultId: 0,
    cancelId: 1,
    title: 'Scraper Agent — action needed',
    message: 'Crawl paused',
    detail: reason + '\n\nHandle it in the scraper window (solve the check, sign in, …), '
      + 'then click Continue. Or stop this crawl.',
  }).then(({ response }) => {
    if (myToken !== pauseToken) return; // a newer pause superseded this dialog
    if (response === 1) { crawlAborted = true; resolveContinue('stop'); }
    else resolveContinue('manual');
  }).catch(() => { /* dialog dismissed */ });
}

function resolveContinue(how) {
  if (!awaitContinue) return false;
  if (awaitTimer) clearTimeout(awaitTimer);
  const r = awaitContinue;
  awaitContinue = null;
  sendToDash('agent:awaiting', { waiting: false });
  updateTray();
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

  // Closing the scraper window must NOT kill an in-flight crawl. While a crawl is
  // running we intercept the close and just HIDE the window — the crawl keeps going
  // in the background (re-show it any time from the dashboard). When idle (or on a
  // real app quit) we let it close normally so nothing lingers.
  scrapeWin.on('close', (e) => {
    const crawling = scheduler && scheduler.isRunning();
    if (!isQuitting && crawling && scrapeWin && !scrapeWin.isDestroyed()) {
      e.preventDefault();
      scrapeWin.hide();
      bus.emit('progress', 'scraper window hidden — crawl continues in the background');
      sendToDash('agent:status-update', buildStatus());
    }
  });
  scrapeWin.on('closed', () => { scrapeWin = null; sendToDash('agent:status-update', buildStatus()); });
  sendToDash('agent:status-update', buildStatus()); // window now exists & visible → refresh Show/Hide label
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
    icon: path.join(__dirname, 'assets', 'tray.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  dashWin.setMenuBarVisibility(false);
  dashWin.loadFile(path.join(__dirname, 'dashboard.html'));
  dashWin.on('close', (e) => {
    // Closing the window minimizes to the tray instead of quitting the agent
    // (where the tray is dependable). A real quit sets isQuitting first.
    if (!isQuitting && tray && HIDE_ON_CLOSE) { e.preventDefault(); dashWin.hide(); }
  });
  dashWin.on('closed', () => { dashWin = null; });
  return dashWin;
}

function sendToDash(channel, payload) {
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send(channel, payload);
}

// ── tray ──────────────────────────────────────────────────────────────────
function showDashboard() {
  if (!dashWin || dashWin.isDestroyed()) return createDashboardWindow();
  if (dashWin.isMinimized()) dashWin.restore();
  dashWin.show();
  dashWin.focus();
  return dashWin;
}

function updateTray() {
  if (!tray) return;
  const running = scheduler ? scheduler.isRunning() : false;
  tray.setToolTip(
    awaitContinue ? 'Scraper Agent — waiting for you'
      : running ? 'Scraper Agent — crawling…'
      : 'Scraper Agent — idle'
  );
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    if (img.isEmpty()) { console.warn('[agent] tray icon missing — running without a tray'); return; }
    tray = new Tray(img);
    tray.setToolTip('Scraper Agent — idle');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open dashboard', click: () => showDashboard() },
      { label: 'Show scraper window', click: () => { if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); } } },
      { type: 'separator' },
      { label: 'Run crawl now', click: () => { if (scheduler) scheduler.runNow().catch((e) => bus.emit('error', e)); } },
      { type: 'separator' },
      { label: 'Quit', click: () => requestQuit() },
    ]));
    // Clicking the tray always surfaces the dashboard (reliable across WMs;
    // a stale isVisible() under WSLg could otherwise hide an off-screen window).
    tray.on('click', () => showDashboard());
  } catch (e) {
    console.warn('[agent] could not create tray:', e && e.message);
    tray = null;
  }
}

// Quit, but guard against killing a crawl mid-flight (incl. one paused for a
// manual challenge/sign-in — scheduler.isRunning() stays true the whole time).
function requestQuit() {
  if (scheduler && scheduler.isRunning()) {
    const choice = dialog.showMessageBoxSync(dashWin && !dashWin.isDestroyed() ? dashWin : undefined, {
      type: 'warning',
      buttons: ['Keep running', 'Stop & quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Crawl in progress',
      message: 'A crawl is currently running.',
      detail: 'Concerts already pushed to the backend are saved. Quitting now stops the rest of this crawl.',
    });
    if (choice === 0) return; // user chose to keep it running
  }
  isQuitting = true;
  app.quit();
}

function buildStatus() {
  const scraperExists = !!(scrapeWin && !scrapeWin.isDestroyed());
  return {
    running: scheduler ? scheduler.isRunning() : false,
    nextRunAt: scheduler && cfg && cfg.runsPerDay > 0 && scheduler.nextRunTime
      ? scheduler.nextRunTime.toISOString() : null,
    lastResult: scheduler ? scheduler.lastResult : null,
    lastError,
    scraperExists,
    scraperVisible: scraperExists && scrapeWin.isVisible(),
  };
}

// ── one crawl + push cycle ──────────────────────────────────────────────────
async function runScrapeAndPush() {
  lastError = null;
  crawlAborted = false;
  updateTray();
  const win = ensureScrapeWindow();
  bus.emit('progress', `crawl start: ${cfg.countries.join(',')} (≤${cfg.maxPages} pages each)`);

  // runId namespaces this crawl's batch ids so a re-run re-enqueues fresh batches
  // (page batchIds are idempotent WITHIN a run, so a retried push never dupes).
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let queued = 0;      // concerts the backend accepted
  let batches = 0;     // pages successfully enqueued
  let pushErrors = 0;  // pages that failed to enqueue (after retries)

  const concerts = await scraper.crawl(win, cfg, {
    onChallenge: () => bus.emit('challenge'),
    onProgress: (m) => bus.emit('progress', m),
    // Pause the crawl and wait for the user to act in the scraper window.
    waitForContinue: (reason) => requestContinue(reason),
    // True once the user picks "Stop this crawl" — bails the whole crawl.
    shouldAbort: () => crawlAborted,
    // Async delivery: push each scraped page to the backend queue, then scrape on.
    onPage: async (events, meta) => {
      if (!events.length) return;
      const batchId = `${runId}-${meta.cc}-p${meta.page}`;
      try {
        const res = await ingest.pushBatch(events, {
          url: cfg.ingestUrl, token: cfg.ingestToken, batchId, source: `${meta.cc} p${meta.page}`,
        });
        queued += events.length;
        batches += 1;
        bus.emit('progress', `  ↑ queued ${meta.cc} p${meta.page}: ${events.length} (${(res && res.status) || 'accepted'})`);
      } catch (err) {
        pushErrors += 1;
        bus.emit('progress', `  ⚠ push ${meta.cc} p${meta.page} failed: ${err.message}`);
      }
    },
  });

  // Local debug dump of everything scraped this run.
  try {
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'last-run.json'), JSON.stringify(concerts, null, 2));
  } catch (e) {
    bus.emit('progress', 'could not write debug dump: ' + e.message);
  }

  if (pushErrors > 0) {
    bus.emit('error', new Error(`${pushErrors} page push(es) failed this run — see log; they'll re-send next crawl`));
  }
  const result = { received: queued, scraped: concerts.length, batches, pushErrors };
  bus.emit('pushed', result);
  bus.emit('done', result);
  return result;
}

// ── lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // a prior instance owns this profile
  cfg = config.load();
  if (!cfg.ingestToken) {
    console.warn('[agent] WARNING: ingestToken not set (CM_INGEST_TOKEN or in the dashboard) — pushes will fail.');
  }
  createDashboardWindow();

  // interference bus → console + dashboard
  bus.on('progress', (m) => { console.log('[agent]', m); sendToDash('agent:log', { level: 'info', msg: m }); });
  bus.on('pushed', (s) => {
    const msg = `queued ${s.received} concert(s) in ${s.batches} batch(es)`
      + (s.pushErrors ? `, ${s.pushErrors} failed` : '') + ` (backend ingests them async)`;
    console.log('[agent] ✅', msg);
    sendToDash('agent:log', { level: s.pushErrors ? 'warn' : 'ok', msg });
  });
  bus.on('done', () => { sendToDash('agent:challenge', false); sendToDash('agent:status-update', buildStatus()); updateTray(); });
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
    updateTray();
  });

  scheduler = createScheduler({
    runsPerDay: cfg.runsPerDay,
    anchorHour: cfg.anchorHour,
    jitterMinutes: cfg.jitterMinutes,
    runJob: runScrapeAndPush,
    log: (m) => bus.emit('progress', m),
    // Push fresh status on every scheduler state change (run start/end, next-run
    // armed) so the dashboard never gets stuck on "running…" after a crawl ends —
    // covers scheduled ticks, runNow, and the tray "Run crawl now" alike.
    onChange: () => { sendToDash('agent:status-update', buildStatus()); updateTray(); },
  });

  // Tray runs in the background (a real desktop install). Skip in headless
  // run-once mode, which has no UI lifetime to attach to.
  if (!process.env.CM_RUN_ONCE) createTray();

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
    if (scrapeWin && !scrapeWin.isDestroyed()) {
      scrapeWin.show(); scrapeWin.focus();
      sendToDash('agent:status-update', buildStatus());
      return { exists: true, visible: true };
    }
    return { exists: false, visible: false };
  });
  // Footer button: show ⇄ hide the scraper window. Hiding keeps the crawl running
  // in the background; the window only exists while/after a crawl has opened it.
  ipcMain.handle('agent:toggleScraper', () => {
    if (!scrapeWin || scrapeWin.isDestroyed()) return { exists: false, visible: false };
    if (scrapeWin.isVisible()) scrapeWin.hide();
    else { scrapeWin.show(); scrapeWin.focus(); }
    const visible = !scrapeWin.isDestroyed() && scrapeWin.isVisible();
    sendToDash('agent:status-update', buildStatus());
    return { exists: true, visible };
  });
  // Stop the current crawl. Sets the abort flag (honored at the next page/country
  // boundary) and, if the crawl is paused waiting for Continue, unblocks it as a
  // stop so it bails immediately instead of waiting out the pause.
  ipcMain.handle('agent:stop', () => {
    if (!scheduler || !scheduler.isRunning()) return { ok: false, error: 'no crawl running' };
    crawlAborted = true;
    const wasPaused = resolveContinue('stop');
    bus.emit('progress', wasPaused
      ? 'stop requested — halting the paused crawl'
      : 'stop requested — halting after the current page');
    return { ok: true };
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
        .finally(() => { if (process.env.CM_RUN_ONCE) { isQuitting = true; console.log('[agent] CM_RUN_ONCE — quitting'); app.quit(); } });
    }, 3000);
  }

  // Scheduled cadence runs only when enabled (runsPerDay > 0) and not headless.
  if (!process.env.CM_RUN_ONCE && cfg.runsPerDay > 0) scheduler.start();
});

// Any genuine quit path (tray Quit, Cmd/Ctrl+Q, OS shutdown) flips this so the
// dashboard's close handler stops minimizing-to-tray and lets the app exit.
app.on('before-quit', () => { isQuitting = true; });

// With a dependable tray the agent keeps running in the background when its
// windows close; otherwise (Linux/WSLg, headless, or tray unavailable) closing
// the last window exits.
app.on('window-all-closed', () => { if (!tray || !HIDE_ON_CLOSE) app.quit(); });

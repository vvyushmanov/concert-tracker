/*
 * main.js — Electron lifecycle + wiring for the concerts-metal scraper agent.
 *
 * Productionizes the PoC into modules: config + scraper + ingestClient +
 * scheduler + interference bus. It opens ONE visible Chromium window with the
 * persistent profile, crawls on a daily schedule (and once shortly after
 * launch), and pushes concerts to the backend's POST /api/ingest.
 *
 * ┌─ CRITICAL — DO NOT CHANGE ───────────────────────────────────────────────┐
 * │ webPreferences.partition MUST stay 'persist:cm'. That persistent Chromium │
 * │ profile (under userData/Partitions/cm) holds the Cloudflare clearance     │
 * │ cookie — it IS the entire antibot bypass. Never rename the partition and  │
 * │ never wipe userData on update, or every run will face a fresh Turnstile.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Run:
 *   cd poc/electron-cm
 *   CM_INGEST_TOKEN=<token> CM_INGEST_URL=http://localhost:3000/api/ingest npm start
 *   CM_RUN_ONCE=1 ... npm start     # crawl once, push, then quit (for testing)
 *   CM_COUNTRY=ge ... npm start     # single country
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const scraper = require('./scraper');
const ingest = require('./ingestClient');
const { createScheduler } = require('./scheduler');
const bus = require('./interference');

// ┌─ CRITICAL — DO NOT CHANGE ───────────────────────────────────────────────┐
// │ Pin the Electron app name. Electron derives userData (where the           │
// │ 'persist:cm' profile + Cloudflare clearance live) FROM the app name, which │
// │ defaults to package.json "name". Renaming the package silently relocates   │
// │ userData to a fresh, un-cleared profile — i.e. it WIPES the antibot bypass │
// │ and every run faces a failing Turnstile. This pins the profile path to the │
// │ one the original PoC warmed up, regardless of package.json. Must run before │
// │ app 'ready' / any getPath('userData'). Keep this value forever.            │
// └───────────────────────────────────────────────────────────────────────────┘
app.setName('concerts-metal-browser-poc');

let scrapeWin = null;
let scheduler = null;
let cfg = null;

function createScrapeWindow() {
  scrapeWin = new BrowserWindow({
    width: 1280,
    height: 950,
    show: true,
    // ⚠️ The persistent profile is the antibot bypass — never change this.
    webPreferences: { partition: 'persist:cm' },
  });
  scrapeWin.on('closed', () => { scrapeWin = null; });
  return scrapeWin;
}

function ensureScrapeWindow() {
  if (!scrapeWin || scrapeWin.isDestroyed()) createScrapeWindow();
  return scrapeWin;
}

/** One crawl + push cycle. Returns the backend stats (or {received:0}). */
async function runScrapeAndPush() {
  const win = ensureScrapeWindow();
  bus.emit('progress', `crawl start: ${cfg.countries.join(',')} (≤${cfg.maxPages} pages each)`);

  const concerts = await scraper.crawl(win, cfg, {
    onChallenge: () => bus.emit('challenge'),
    onProgress: (m) => bus.emit('progress', m),
  });

  // Optional local debug dump (matches the PoC's out/all.json).
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
  const stats = await ingest.postConcerts(concerts, {
    url: cfg.ingestUrl,
    token: cfg.ingestToken,
  });
  bus.emit('pushed', stats);
  bus.emit('done', { received: concerts.length, stats });
  return stats;
}

app.whenReady().then(() => {
  cfg = config.load();
  if (!cfg.ingestToken) {
    console.warn('[agent] WARNING: ingestToken not set (CM_INGEST_TOKEN or agent-config.json) — pushes will fail.');
  }
  createScrapeWindow();

  // ── interference bus listeners ──────────────────────────────────────────
  // M2: when a Turnstile gate is detected, surface the window so a human can
  // solve it. M3 will add a Telegram relay subscribing to the SAME events.
  bus.on('challenge', () => {
    if (scrapeWin && !scrapeWin.isDestroyed()) { scrapeWin.show(); scrapeWin.focus(); }
  });
  bus.on('progress', (m) => console.log('[agent]', m));
  bus.on('pushed', (s) => console.log('[agent] ✅ ingested →', JSON.stringify(s)));
  bus.on('error', (e) => console.error('[agent] ❌', e && e.message ? e.message : e));

  scheduler = createScheduler({
    runsPerDay: cfg.runsPerDay,
    anchorHour: cfg.anchorHour,
    jitterMinutes: cfg.jitterMinutes,
    runJob: runScrapeAndPush,
    log: (m) => bus.emit('progress', m),
  });

  if (cfg.autoStartOnLaunch || process.env.CM_RUN_ONCE) {
    // Give the window a moment to exist, then crawl once.
    setTimeout(() => {
      scheduler.runNow()
        .catch((e) => bus.emit('error', e))
        .finally(() => { if (process.env.CM_RUN_ONCE) { console.log('[agent] CM_RUN_ONCE — quitting'); app.quit(); } });
    }, 3000);
  }

  if (!process.env.CM_RUN_ONCE) scheduler.start();
});

app.on('window-all-closed', () => app.quit());

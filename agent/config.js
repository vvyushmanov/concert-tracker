/*
 * config.js — agent configuration, persisted as JSON in Electron's userData,
 * with environment-variable overrides (handy for dev / headless runs).
 *
 * Precedence: saved agent-config.json (the dashboard's authority) > env vars > DEFAULTS.
 * Env vars seed first-run defaults (handy for dev / headless) but do NOT mask a
 * value the user has saved from the UI. The pure behaviour flags CM_RUN_ONCE /
 * CM_AUTOSTART are runtime-only (read in main.js), not part of this config.
 * userData lives next to the 'persist:cm' Chromium profile — do NOT delete it.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ingestUrl: 'http://localhost:3000/api/ingest',
  ingestToken: '',          // REQUIRED to push; set via env CM_INGEST_TOKEN or agent-config.json
  countries: ['fr', 'ge', 'de', 'tr'],
  maxPages: 3,
  runsPerDay: 2,            // 1 = once daily, 2 = twice daily
  anchorHour: 9,            // first daily slot (local hour)
  jitterMinutes: 90,        // +/- spread around each scheduled slot
  pageDelayMs: 2200,        // base human-paced delay between pages
  autoStartOnLaunch: true,  // run a crawl shortly after launch
  loginEmail: '',           // concerts-metal sign-in email (stored in userData, never the repo)
  loginPassword: '',        // concerts-metal sign-in password (stored in userData, never the repo)
  // Sign-in automation when the crawl hits concerts-metal's gate:
  //   'auto' — navigate limit.html → login.html, fill the form, click Sign in
  //   'fill' — only fill the form on login.html (you click Sign in)
  //   'off'  — do nothing
  loginMode: 'auto',
  // Landing on a URL containing this marker (the member id/slug, e.g.
  // "u25849__Headbanger") means sign-in succeeded → resume the crawl. Blank =
  // auto-detect any /u<digits>__ profile path.
  loginSuccessMarker: '',
};

const LOGIN_MODES = ['auto', 'fill', 'off'];

function configPath() {
  return path.join(app.getPath('userData'), 'agent-config.json');
}

function readFileConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf-8')); }
  catch { return {}; }
}

function envOverrides() {
  const env = {};
  if (process.env.CM_INGEST_URL) env.ingestUrl = process.env.CM_INGEST_URL;
  if (process.env.CM_INGEST_TOKEN) env.ingestToken = process.env.CM_INGEST_TOKEN;
  if (process.env.CM_COUNTRIES) {
    env.countries = process.env.CM_COUNTRIES.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (process.env.CM_COUNTRY) {
    env.countries = [process.env.CM_COUNTRY.trim()];
  }
  if (process.env.CM_MAX_PAGES) env.maxPages = parseInt(process.env.CM_MAX_PAGES, 10);
  if (process.env.CM_RUNS_PER_DAY) env.runsPerDay = parseInt(process.env.CM_RUNS_PER_DAY, 10);
  if (process.env.CM_LOGIN_EMAIL) env.loginEmail = process.env.CM_LOGIN_EMAIL;
  if (process.env.CM_LOGIN_PASSWORD) env.loginPassword = process.env.CM_LOGIN_PASSWORD;
  if (process.env.CM_LOGIN_MODE && LOGIN_MODES.includes(process.env.CM_LOGIN_MODE)) {
    env.loginMode = process.env.CM_LOGIN_MODE;
  }
  if (process.env.CM_LOGIN_SUCCESS_MARKER) env.loginSuccessMarker = process.env.CM_LOGIN_SUCCESS_MARKER;
  return env;
}

// Keys the dashboard may persist. Anything else in an IPC payload is ignored,
// so a buggy/hostile renderer can't write arbitrary keys into the config file.
const PERSISTABLE_KEYS = [
  'ingestUrl', 'ingestToken', 'countries', 'maxPages',
  'runsPerDay', 'anchorHour', 'jitterMinutes', 'pageDelayMs', 'autoStartOnLaunch',
  'loginEmail', 'loginPassword', 'loginMode', 'loginSuccessMarker',
];

/** Effective config: DEFAULTS <- env (first-run seed) <- saved file (authoritative). */
function load() {
  const file = readFileConfig();
  const env = envOverrides();
  // Resolve loginMode: an explicit new value (file or env) wins; else fall back to
  // the legacy `autofillLogin` boolean if the saved file predates loginMode; else
  // the default. Guard against any invalid persisted/env value.
  let mode = file.loginMode !== undefined ? file.loginMode : env.loginMode;
  if (mode === undefined && typeof file.autofillLogin === 'boolean') {
    mode = file.autofillLogin ? 'auto' : 'off';
  }
  if (!LOGIN_MODES.includes(mode)) mode = DEFAULTS.loginMode;
  const cfg = { ...DEFAULTS, ...env, ...file, loginMode: mode };
  delete cfg.autofillLogin;
  return cfg;
}

/** Persist a whitelisted partial update to agent-config.json. */
function save(partial) {
  const clean = {};
  for (const k of PERSISTABLE_KEYS) {
    if (partial && Object.prototype.hasOwnProperty.call(partial, k)) clean[k] = partial[k];
  }
  const merged = { ...readFileConfig(), ...clean };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return load();
}

module.exports = { DEFAULTS, LOGIN_MODES, configPath, load, save };

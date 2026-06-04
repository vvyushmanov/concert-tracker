/*
 * config.js — agent configuration, persisted as JSON in Electron's userData,
 * with environment-variable overrides (handy for dev / headless runs).
 *
 * Precedence: env vars > saved agent-config.json > DEFAULTS.
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
};

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
  return env;
}

/** Effective config (DEFAULTS <- file <- env). */
function load() {
  return { ...DEFAULTS, ...readFileConfig(), ...envOverrides() };
}

/** Persist a partial update to agent-config.json (env still wins at load time). */
function save(partial) {
  const merged = { ...readFileConfig(), ...partial };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return load();
}

module.exports = { DEFAULTS, configPath, load, save };

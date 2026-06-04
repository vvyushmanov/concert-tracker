# concerts-metal scraper agent

A desktop **scraper agent**: instead of a server scraper (dead — Cloudflare Turnstile), it runs a
**real Chromium browser in a visible window** with a *persistent profile*. You solve the Turnstile
once if it appears; the clearance cookie sticks, so later runs are hands-off. It reads concerts
straight from the rendered DOM and **pushes them to the backend's `POST /api/ingest`** (outbound
HTTPS, bearer-token auth) — which hands them to `ingest_json.py` → the global concert tables.

Grew out of the PoC ([git history of `main.js`]); now split into modules.

## Modules

| file | role |
|------|------|
| `main.js`         | Electron lifecycle; owns the visible scrape window; wires everything |
| `config.js`       | config persisted in `userData` (`agent-config.json`) + env overrides |
| `scraper.js`      | `EXTRACTOR` (in-page microdata reader) + `crawl()` over countries/pages |
| `ingestClient.js` | `postConcerts()` → `POST /api/ingest` with `Authorization: Bearer` |
| `scheduler.js`    | `nextRunAt()` cadence math + daily-with-jitter loop, no-overlap guard |
| `interference.js` | shared event bus (`challenge`/`progress`/`pushed`/`done`/`error`) |

## ⚠️ The persistent profile IS the antibot bypass

`main.js` creates the scrape window with `webPreferences.partition: 'persist:cm'`. That profile
(under `userData/Partitions/cm`) holds the Cloudflare clearance cookie. **Never rename the partition
and never wipe `userData` on update** — doing so throws away the bypass and every run faces a fresh
Turnstile.

⚠️ **Also: do not change the app name.** Electron derives `userData` from the app name. `main.js`
pins `app.setName('concerts-metal-browser-poc')` so the profile path is stable regardless of
`package.json`. Changing the package `"name"` *without* that pin silently relocates `userData` to a
brand-new empty profile — the same as wiping the bypass.

## Run

```bash
cd agent
npm install        # one-time; downloads Electron (bundles Chromium)

# Point at the backend + authenticate. The token must match the backend's
# INGEST_TOKEN (in the repo-root .env / the web service's environment).
CM_INGEST_TOKEN=$(grep '^INGEST_TOKEN=' ../.env | cut -d= -f2) \
CM_INGEST_URL=http://localhost:3000/api/ingest \
CM_RUN_ONCE=1 CM_COUNTRY=ge CM_MAX_PAGES=1 \
npm start
```

### Config / env vars

| env | meaning | default |
|-----|---------|---------|
| `CM_INGEST_TOKEN`  | bearer token for `/api/ingest` (**required to push**) | — |
| `CM_INGEST_URL`    | ingest endpoint URL | `http://localhost:3000/api/ingest` |
| `CM_COUNTRIES`     | comma-separated country codes | `fr,ge,de,tr` |
| `CM_COUNTRY`       | single country (shorthand) | — |
| `CM_MAX_PAGES`     | pages per country | `3` |
| `CM_RUNS_PER_DAY`  | `1` (once) or `2` (twice) daily | `2` |
| `CM_RUN_ONCE`      | crawl once, push, then quit (no scheduling) | — |

Anything not set by env falls back to `agent-config.json` in `userData`, then built-in defaults.

### What you'll see

A Chromium window opens on `https://en.concerts-metal.com/next_<cc>_p<page>.html`.

- If a **Turnstile / "Human Verification"** appears → **solve it in the window** (once). The agent
  surfaces/focuses the window automatically and keeps polling; the moment the listing renders it
  extracts.
- Console logs `[agent] …` progress and, on success, `[agent] ✅ ingested → {received, before, after, new, …}`.
- A debug copy of the last crawl is written to `out/last-run.json`.

## The proof (M2 acceptance)

1. Run the command above. Solve the Turnstile once if shown → confirm `✅ ingested` with `new > 0`,
   and that the concerts appear in the backend DB.
2. **Run the exact same command again → NO Turnstile appears** (the `persist:cm` profile kept the
   `cf_clearance` cookie). That is the antibot being naturally bypassed.

## Note on WSL

Node is on your WSL host. On Windows 11, WSLg shows the Electron window on your Windows desktop
automatically. If no window appears, run from a Windows terminal instead (Node needed there too).

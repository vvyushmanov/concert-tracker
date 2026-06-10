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
| `loginAutofill.js`| pure helpers for the sign-in flow: detect limit/login/profile URLs + build the page-probe and the fill/submit scripts |
| `countries.js`    | pure country code↔name helpers (ICU-backed), shared by `config.js` and the Settings renderer: `resolveCountry`, `allCountries`, `normalizeCountryState` |
| `dashboard.*` / `settings.*` | the control window (status + activity + run) and the separate tabbed Settings window (Connection / Sign-in / Crawl) |

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
| `CM_LOGIN_EMAIL`   | concerts-metal sign-in email | — |
| `CM_LOGIN_PASSWORD`| concerts-metal sign-in password | — |
| `CM_LOGIN_MODE`    | `auto` / `fill` / `off` (see below) | `auto` |
| `CM_LOGIN_SUCCESS_MARKER` | URL substring that means "signed in" (your member id/slug, e.g. `u25849`) | — (auto-detect) |

Anything not set by env falls back to `agent-config.json` in `userData`, then built-in defaults.
All of this is editable in the **Settings** window (⚙ in the dashboard footer), split into three
tabs — **Connection** (backend URL + ingest token), **Sign-in** (email / password / mode / profile
marker), **Crawl** (countries, pages, schedule, launch). Saved to `agent-config.json` — never to the
repo (the password lives only in `userData`).

#### Countries (Settings → Crawl)

Add a country by **name or ISO code** — type `Turkey` or `tr`, `Germany` or `de` — resolved via the
platform's own Intl/ICU data (so `countries.js` keeps no hand-maintained list). Each country sits in a
**roster** with a tick box: ticked → crawled; unticked → kept in the list but **skipped** this run; `✕`
removes it. Two persisted fields back this (reconciled by `config.load` → `normalizeCountryState`):
`countries` is the active code list the scraper consumes (`next_<cc>_…`), and `countryRoster` is the
full `[{code,name}]` list including de-selected entries. `CM_COUNTRIES=fr,ge,…` still seeds the active
set on a fresh profile.

### Sign-in automation

concerts-metal gates the crawl: once Cloudflare passes it can drop you on **`limit.html`**, and
signing in unlocks the listings. The agent automates that whole chain. **Mode** (dashboard *Sign-in*
select / `loginMode`):

| mode | behaviour |
|------|-----------|
| `auto` *(default)* | on `limit.html` → open `login.html`; on `login.html` → fill creds **and click Sign in**; on landing back at your profile → **resume the crawl** |
| `fill` | on `login.html` → fill creds only; you click Sign in (and Continue) |
| `off`  | don't touch the sign-in form |

Field detection is heuristic (the live form is behind Cloudflare, so exact names aren't known):
password by `type=password`; the login field by `type=email` → a name/id/placeholder hint → the
visible text input just before the password box; the Sign-in button by `type=submit` → a button
labelled log in/sign in/connexion/valider/…. A **3-try cap** stops a wrong password from looping
`limit → login → submit`; it resets once you're past the gate.

**Cloudflare on `login.html`.** Opening the sign-in page can itself trip a *fresh* Cloudflare
check. The agent never injects the autofill into that interstitial — a DOM script looping inside a
live challenge can wedge it to a **blank/white screen** that only a reload clears. Instead it
**probes** what rendered (`buildLoginPageProbeScript`) and branches: a real form → fill it; a
human check (Cloudflare text, or a `challenges.cloudflare.com` / Turnstile iframe) → surface the
window so **you can solve the captcha**, no injection; a blank render → one capped reload to summon
the widget. So when a check is required you get the interactive challenge, not a dead white page.

**Resume signal.** After a successful sign-in concerts-metal lands you on your member profile
(e.g. `https://en.concerts-metal.com/u25849__Headbanger`). Set **Profile marker**
(`loginSuccessMarker`) to your member id or slug (`u25849` is enough) so the agent recognises that
page and auto-resumes a paused crawl. Leave it blank to auto-detect any `/u<digits>__…` profile path.

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

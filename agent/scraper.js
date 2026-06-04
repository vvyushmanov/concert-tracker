/*
 * scraper.js — drive a real Chromium window over concerts-metal.com and read
 * concerts out of the rendered DOM.
 *
 * Lifted verbatim from the proven PoC (main.js): the in-page EXTRACTOR is a
 * faithful JS port of the Python html_extractor.py schema.org-microdata reader,
 * and getPage() polls while a Cloudflare/Turnstile challenge is on screen so a
 * human can solve it once. Parameterized by the BrowserWindow + hooks so main.js
 * owns the window lifecycle and the interference bus.
 *
 * Output objects use the snake_case keys ConcertDatabaseWriter.write_concerts()
 * consumes — no field mapping needed downstream.
 */

// In-page extractor — faithful JS port of concert-tracker html_extractor.py.
const EXTRACTOR = `(function () {
  const base = location.origin;
  const abs = (u) => { if (!u) return null; try { return new URL(u, base).href; } catch (e) { return u; } };
  const txt = (el) => (el ? (el.getAttribute('content') || '').trim() : null);

  const divs = Array.from(document.querySelectorAll('div[itemtype="https://schema.org/MusicEvent"]'));
  const events = divs.map((div) => {
    let event_name = null;
    div.querySelectorAll('meta[itemprop="name"]').forEach((m) => {
      if (event_name) return;
      if (!m.closest('div[itemprop="location"]')) event_name = (m.getAttribute('content') || '').trim();
    });
    const urlA = div.querySelector('a[itemprop="url"]');
    const event_url = urlA ? abs(urlA.getAttribute('href')) : null;

    const loc = div.querySelector('div[itemprop="location"]');
    let venue = null, city = null, country = null, postal_code = null;
    if (loc) {
      venue = txt(loc.querySelector('meta[itemprop="name"]'));
      const addr = loc.querySelector('div[itemprop="address"]');
      if (addr) {
        city = txt(addr.querySelector('meta[itemprop="addressLocality"]'));
        country = txt(addr.querySelector('meta[itemprop="addressCountry"]'));
        postal_code = txt(addr.querySelector('meta[itemprop="postalCode"]'));
      }
    }
    const performers = Array.from(div.querySelectorAll('div[itemprop="performer"]'))
      .map((p) => txt(p.querySelector('meta[itemprop="name"]'))).filter(Boolean);

    let organizer = null, organizer_url = null;
    const orgDiv = div.querySelector('div[itemprop="organizer"]');
    if (orgDiv) {
      organizer = txt(orgDiv.querySelector('meta[itemprop="name"]'));
      organizer_url = txt(orgDiv.querySelector('meta[itemprop="url"]'));
    }
    const ticket_links = Array.from(div.querySelectorAll('span[itemprop="offers"]')).map((off) => {
      const link = off.querySelector('a[itemprop="url"]');
      if (!link) return null;
      const t = { vendor: link.textContent.trim(), url: link.getAttribute('href') };
      const price = txt(off.querySelector('meta[itemprop="price"]'));
      const cur = txt(off.querySelector('meta[itemprop="priceCurrency"]'));
      if (price && cur) t.price = price + ' ' + cur;
      return t;
    }).filter(Boolean);

    return {
      event_name, event_url,
      date_start: txt(div.querySelector('meta[itemprop="startDate"]')),
      date_end: txt(div.querySelector('meta[itemprop="endDate"]')),
      venue, city, country, postal_code, performers,
      image_url: txt(div.querySelector('meta[itemprop="image"]')),
      organizer, organizer_url, ticket_links,
    };
  });

  const hay = (document.title + ' ' + location.pathname + ' ' + (document.body ? document.body.innerText.slice(0, 300) : '')).toLowerCase();
  const isChallenge = /check_bot|human verification|turnstile|just a moment/.test(hay) && events.length === 0;
  return { url: location.href, title: document.title, isChallenge, count: events.length, events };
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build the listing URL for a country code + page number. (pure / testable) */
function buildPageUrl(cc, page) {
  return `https://en.concerts-metal.com/next_${cc}_p${page}.html`;
}

function isDead(win) {
  return !win || win.isDestroyed() || win.webContents.isDestroyed();
}

function loadURL(win, url) {
  return new Promise((resolve) => {
    if (isDead(win)) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    try {
      win.webContents.once('did-stop-loading', finish);
      win.loadURL(url).catch(() => {}); // ignore ERR_ABORTED from challenge redirects
    } catch { finish(); return; } // window torn down between checks
    setTimeout(finish, 30000); // safety
  });
}

async function extract(win) {
  if (isDead(win)) return { isChallenge: false, count: 0, events: [], error: 'scraper window closed' };
  try { return await win.webContents.executeJavaScript(EXTRACTOR, true); }
  catch (e) { return { isChallenge: false, count: 0, events: [], error: e.message }; }
}

function currentUrl(win) {
  try { return (!isDead(win) && win.webContents.getURL()) || ''; } catch { return ''; }
}

/** True if `landed` is the same page (by path) we asked for. */
function samePath(requested, landed) {
  try { return new URL(landed).pathname === new URL(requested).pathname; }
  catch { return false; }
}

/**
 * Load a listing page and return its extraction. If we DON'T land on the page we
 * asked for — redirected to a Cloudflare challenge, a sign-in, or a register
 * page — or a Turnstile is detected, the agent hands the full-navigation scraper
 * window to the user (hooks.waitForContinue) and retries on their Continue. A
 * genuinely empty listing (same URL, 0 events) is NOT interference — it just
 * means end-of-pagination. Headless callers (no waitForContinue) fall back to
 * polling the gate for ~3min.
 */
async function getPage(win, url, hooks = {}) {
  if (isDead(win)) return { isChallenge: false, count: 0, events: [], error: 'scraper window closed' };

  let attempts = 0;
  while (true) {
    await loadURL(win, url);
    await wait(2500); // settle / JS render
    if (isDead(win)) return { isChallenge: false, count: 0, events: [], error: 'scraper window closed' };

    const res = await extract(win);
    const onListing = samePath(url, currentUrl(win));
    if (!res.isChallenge && onListing) return res; // landed on the listing → done

    if (hooks.onChallenge) hooks.onChallenge();

    if (!hooks.waitForContinue) {
      // Headless fallback: poll for the gate to clear on its own.
      let waited = 0;
      let r = res;
      while ((r.isChallenge || !samePath(url, currentUrl(win))) && waited < 180000) {
        await wait(5000); waited += 5000;
        if (isDead(win)) break;
        r = await extract(win);
      }
      return r;
    }

    attempts += 1;
    if (attempts > 5) return { ...res, error: 'repeated interference — gave up after 5 tries' };
    const reason = res.isChallenge
      ? 'verification needed — solve it in the scraper window, then Continue'
      : 'redirected — sign in / register in the scraper window, then Continue';
    if (hooks.onProgress) hooks.onProgress('paused — ' + reason);
    const how = await hooks.waitForContinue(reason);
    if (how === 'timeout') {
      return { isChallenge: false, count: 0, events: [], error: 'paused — timed out waiting for Continue' };
    }
    // loop: re-load the requested listing now that the user has acted
  }
}

/**
 * Crawl the configured countries/pages and return the combined concerts array.
 * @param {BrowserWindow} win
 * @param {{countries:string[], maxPages:number, pageDelayMs?:number}} cfg
 * @param {{onChallenge?:Function, onProgress?:(m:string)=>void}} hooks
 */
async function crawl(win, cfg, hooks = {}) {
  const countries = cfg.countries || ['fr', 'ge', 'de', 'tr'];
  const maxPages = cfg.maxPages || 3;
  const baseDelay = cfg.pageDelayMs || 2200;
  const all = [];
  const perCountry = {};

  for (const cc of countries) {
    let page = 1;
    let total = 0;
    while (page <= maxPages) {
      const url = buildPageUrl(cc, page);
      if (hooks.onProgress) hooks.onProgress(`→ ${cc} p${page} …`);
      const res = await getPage(win, url, hooks);
      if (res.error) { if (hooks.onProgress) hooks.onProgress(`  ${cc} p${page} error: ${res.error}`); break; }
      if (hooks.onProgress) hooks.onProgress(`  ${cc} p${page}: ${res.count} events`);
      if (res.count === 0) break;
      for (const e of res.events) { e._sourceCountry = cc; all.push(e); }
      total += res.count;
      page += 1;
      await wait(baseDelay + Math.floor(Math.random() * 1600)); // human-paced jitter
    }
    perCountry[cc] = total;
  }
  if (hooks.onProgress) hooks.onProgress(`crawl totals: ${JSON.stringify(perCountry)} → ${all.length} concerts`);
  return all;
}

module.exports = { EXTRACTOR, buildPageUrl, loadURL, extract, getPage, crawl };

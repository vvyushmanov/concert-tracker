/*
 * Unit tests for the agent's PURE-LOGIC modules — no Electron required.
 *   node test/agent-units.test.js
 *
 * Covers scheduler.nextRunAt (cadence math), scraper.buildPageUrl (URL shape),
 * and ingestClient pushBatch/postConcerts guard clauses. The full crawl +
 * Turnstile + per-page push cycle is the manual Electron checkpoint; the HTTP
 * path against the live route is covered separately (ingest-client-live).
 */
const assert = require('assert');
const vm = require('vm');
const { nextRunAt } = require('../scheduler');
const { buildPageUrl } = require('../scraper');
const { pushBatch, postConcerts } = require('../ingestClient');
const {
  isLoginUrl, isLimitUrl, loginUrlFor, isLoggedInProfileUrl,
  buildLoginPageProbeScript, buildLoginAutofillScript,
} = require('../loginAutofill');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

(async () => {
  console.log('— scheduler.nextRunAt —');
  // Fixed reference: 2026-06-04T12:00:00 local.
  const now = new Date(2026, 5, 4, 12, 0, 0).getTime();

  const n2 = nextRunAt(now, { runsPerDay: 2, anchorHour: 9 });
  check(n2.getTime() > now, 'twice-daily: next run is strictly in the future');
  check(n2.getHours() === 21 && n2.getDate() === 4, 'twice-daily from 12:00: next slot is 21:00 same day');

  const n1 = nextRunAt(now, { runsPerDay: 1, anchorHour: 9 });
  check(n1.getHours() === 9 && n1.getDate() === 5, 'once-daily (anchor 9) from 12:00: next slot is 09:00 next day');

  const beforeAnchor = new Date(2026, 5, 4, 6, 0, 0).getTime(); // 06:00
  const n3 = nextRunAt(beforeAnchor, { runsPerDay: 2, anchorHour: 9 });
  check(n3.getHours() === 9 && n3.getDate() === 4, 'twice-daily from 06:00: next slot is 09:00 same day');

  check(
    nextRunAt(now, { runsPerDay: 2 }).getTime() === nextRunAt(now, { runsPerDay: 2 }).getTime(),
    'nextRunAt is deterministic for a fixed now'
  );
  check(
    nextRunAt(now, {}).getTime() > now,
    'defaults (no opts) still yield a future run'
  );

  console.log('\n— scheduler.onChange (state transitions, fixes stale "running…") —');
  {
    const { createScheduler } = require('../scheduler');
    const states = [];
    let release;
    const sched = createScheduler({
      runJob: () => new Promise((r) => { release = r; }),
      onChange: () => states.push(sched.isRunning()),
      log: () => {},
    });
    const p = sched.runNow();
    check(states[0] === true, 'onChange fired running=true at crawl start');
    release('ok');
    await p;
    check(states[states.length - 1] === false, 'onChange fired running=false at crawl end (clears "running…")');
  }

  console.log('\n— scraper.buildPageUrl —');
  check(buildPageUrl('ge', 2) === 'https://en.concerts-metal.com/next_ge_p2.html', 'builds ge p2 URL');
  check(buildPageUrl('fr', 1) === 'https://en.concerts-metal.com/next_fr_p1.html', 'builds fr p1 URL');

  console.log('\n— ingestClient.postConcerts guards —');
  async function throwsWith(fn, frag, msg) {
    try { await fn(); check(false, msg + ' (did not throw)'); }
    catch (e) { check(String(e.message).includes(frag), `${msg} (threw: "${e.message}")`); }
  }
  await throwsWith(() => postConcerts([], {}), 'ingestUrl not configured', 'missing url throws');
  await throwsWith(() => postConcerts([], { url: 'http://x' }), 'ingestToken not configured', 'missing token throws');
  await throwsWith(() => postConcerts('nope', { url: 'http://x', token: 't' }), 'must be an array', 'non-array payload throws');

  console.log('\n— ingestClient.pushBatch guards (fail fast, before any retry) —');
  await throwsWith(() => pushBatch([], {}), 'ingestUrl not configured', 'missing url throws');
  await throwsWith(() => pushBatch([], { url: 'http://x' }), 'ingestToken not configured', 'missing token throws');
  await throwsWith(() => pushBatch('nope', { url: 'http://x', token: 't' }), 'must be an array', 'non-array payload throws');

  console.log('\n— loginAutofill.isLoginUrl / isLimitUrl —');
  check(isLoginUrl('https://en.concerts-metal.com/login.html'), 'matches the en sign-in page');
  check(isLoginUrl('https://www.concerts-metal.com/login.html'), 'matches any host');
  check(!isLoginUrl('https://en.concerts-metal.com/next_fr_p1.html'), 'rejects a listing page');
  check(!isLoginUrl('https://en.concerts-metal.com/login.html.foo'), 'rejects a non-login path that contains login.html');
  check(!isLoginUrl('not a url'), 'rejects a non-URL string');
  check(isLimitUrl('https://en.concerts-metal.com/limit.html'), 'isLimitUrl matches the limit page');
  check(!isLimitUrl('https://en.concerts-metal.com/login.html'), 'isLimitUrl rejects the login page');

  console.log('\n— loginAutofill.loginUrlFor (preserves origin) —');
  check(loginUrlFor('https://en.concerts-metal.com/limit.html') === 'https://en.concerts-metal.com/login.html', 'en limit → en login');
  check(loginUrlFor('https://www.concerts-metal.com/limit.html') === 'https://www.concerts-metal.com/login.html', 'www limit → www login (same host)');
  check(loginUrlFor('garbage') === 'https://en.concerts-metal.com/login.html', 'falls back to en host on a bad URL');

  console.log('\n— loginAutofill.isLoggedInProfileUrl —');
  check(isLoggedInProfileUrl('https://en.concerts-metal.com/u25849__Headbanger', 'u25849__Headbanger'), 'exact slug marker matches');
  check(isLoggedInProfileUrl('https://en.concerts-metal.com/u25849__Headbanger', 'u25849'), 'id-only marker matches');
  check(!isLoggedInProfileUrl('https://en.concerts-metal.com/u9999__Other', 'u25849'), 'different member id does not match the marker');
  check(isLoggedInProfileUrl('https://en.concerts-metal.com/u25849__Headbanger', ''), 'blank marker auto-detects any /u…__ profile');
  check(!isLoggedInProfileUrl('https://en.concerts-metal.com/next_fr_p1.html', ''), 'a listing page is not a profile');
  check(!isLoggedInProfileUrl('https://en.concerts-metal.com/limit.html', ''), 'the limit page is not a profile');

  console.log('\n— loginAutofill.buildLoginPageProbeScript —');
  // Run the probe against a stub `document` so we can assert each classification
  // without a browser. Mirrors only the DOM calls the probe makes.
  function runProbe({ pwd = false, title = '', text = '', cfIframe = false, iframeCount = 0 } = {}) {
    const document = {
      title,
      body: { innerText: text },
      querySelector(sel) {
        if (sel.indexOf('password') >= 0) return pwd ? {} : null;
        if (sel.indexOf('iframe') >= 0) return cfIframe ? {} : null;
        return null;
      },
      querySelectorAll(sel) { return { length: sel.indexOf('iframe') >= 0 ? iframeCount : 0 }; },
    };
    return vm.runInNewContext(buildLoginPageProbeScript(), { document });
  }
  check(
    (() => { try { new vm.Script(buildLoginPageProbeScript()); return true; } catch { return false; } })(),
    'probe script is syntactically valid JS'
  );
  check(runProbe({ pwd: true }) === 'form', 'a password field present → "form"');
  // A real form wins even if challenge-ish words happen to be on the page.
  check(runProbe({ pwd: true, title: 'Just a moment…' }) === 'form', 'password field wins over challenge text → "form"');
  check(runProbe({ title: 'Just a moment...' }) === 'challenge', 'Cloudflare "Just a moment" title → "challenge"');
  check(runProbe({ text: 'Verifying you are human. This may take a few seconds.' }) === 'challenge', 'human-verification body text → "challenge"');
  check(runProbe({ cfIframe: true }) === 'challenge', 'a challenges.cloudflare.com iframe → "challenge"');
  check(runProbe({ text: '', iframeCount: 0 }) === 'blank', 'empty body, no iframe → "blank" (white screen → reload)');
  check(runProbe({ text: '', iframeCount: 1 }) === 'other', 'empty body but an iframe present → NOT blank (a live widget — never reload it)');
  check(runProbe({ text: 'Some other page with plenty of text here.' }) === 'other', 'a populated non-form, non-check page → "other"');

  console.log('\n— loginAutofill.buildLoginAutofillScript —');
  // Compiling (without running) proves the generated source is valid JS.
  check(
    (() => { try { new vm.Script(buildLoginAutofillScript('a@b.com', 'pw')); return true; } catch { return false; } })(),
    'generated script is syntactically valid JS'
  );
  // A password with quotes/backslashes/newlines must not break out of the string.
  const nasty = `x"';\n\\</script>`;
  const script = buildLoginAutofillScript('u@e.com', nasty);
  check(
    (() => { try { new vm.Script(script); return true; } catch { return false; } })(),
    'embeds a quote/backslash/newline-laden password without breaking syntax'
  );
  check(script.includes(JSON.stringify(nasty)), 'password is embedded via JSON.stringify (escaped)');
  check(
    (() => { try { new vm.Script(buildLoginAutofillScript('u@e.com', 'pw', true)); return true; } catch { return false; } })(),
    'submit-mode script is also syntactically valid JS'
  );
  // The no-creds branch returns before touching the DOM, so it runs in a bare sandbox.
  check(
    vm.runInNewContext(buildLoginAutofillScript('', '')) === 'no-creds',
    'returns "no-creds" when both fields are empty'
  );
  check(
    vm.runInNewContext(buildLoginAutofillScript('', '', true)) === 'no-creds',
    'returns "no-creds" with submit=true and empty creds'
  );

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();

/*
 * loginAutofill.js — pure helpers for concerts-metal's sign-in flow.
 *
 * Kept Electron-free (like scraper.buildPageUrl) so it's unit-testable on plain
 * node. main.js owns the wiring: it watches the scraper window's navigations and
 *   • on limit.html  → navigates it to the sign-in page (loginUrlFor)
 *   • on login.html  → injects buildLoginAutofillScript(...) to fill (+ optionally
 *                       submit) the form.
 *
 * The full chain (limit → login → fill → click Sign in) runs only in "auto" mode;
 * "fill" mode fills and lets the user click Sign in; "off" disables it.
 */

const LOGIN_PATH = '/login.html';
const LIMIT_PATH = '/limit.html';

/** True when `u` is concerts-metal's sign-in page (any host/scheme). */
function isLoginUrl(u) {
  try { return new URL(u).pathname.toLowerCase().endsWith(LOGIN_PATH); }
  catch { return false; }
}

/** True when `u` is the "limit reached" interstitial Cloudflare drops us on. */
function isLimitUrl(u) {
  try { return new URL(u).pathname.toLowerCase().endsWith(LIMIT_PATH); }
  catch { return false; }
}

/** The sign-in URL on the SAME origin as `currentUrl` (preserves en/www host). */
function loginUrlFor(currentUrl) {
  try { return new URL(LOGIN_PATH, currentUrl).href; }
  catch { return 'https://en.concerts-metal.com' + LOGIN_PATH; }
}

/**
 * True when `u` looks like the signed-in member's profile page — the signal that
 * a sign-in succeeded (e.g. /u25849__Headbanger). If `marker` is set (the user's
 * id or full slug, e.g. "u25849") the path must contain it; otherwise any
 * /u<digits>__ profile path counts.
 */
function isLoggedInProfileUrl(u, marker) {
  let path;
  try { path = new URL(u).pathname; } catch { return false; }
  if (marker) return path.toLowerCase().includes(String(marker).toLowerCase());
  return /\/u\d+__/i.test(path);
}

/**
 * Build a self-contained probe (run in the sign-in page) that classifies what
 * actually rendered there, so main.js can decide what to do BEFORE touching it.
 * Returns one of:
 *   "form"      — the real sign-in form is present (an input[type=password]) →
 *                 safe to autofill.
 *   "challenge" — a Cloudflare/Turnstile human check is up (markers in the page
 *                 text OR a challenges.cloudflare.com / turnstile iframe) → DO NOT
 *                 inject anything (a DOM script can wedge the challenge to a blank
 *                 screen); surface the window so the user can solve it.
 *   "blank"     — no form, no recognizable check, and an essentially-empty body
 *                 with no iframes → the challenge came up as a white screen; a
 *                 single reload usually makes Cloudflare draw the interactive
 *                 widget. (We DON'T treat a near-empty body that has an iframe as
 *                 blank — that's a live Turnstile widget in a cross-origin frame,
 *                 and reloading it would reset a check the user may be solving.)
 *   "other"     — some other page; leave it for the user.
 *   "error"     — the probe threw (treated like "other").
 */
function buildLoginPageProbeScript() {
  return '(function(){try{'
    + 'if(document.querySelector(\'input[type="password"]\'))return "form";'
    + 'var hay=((document.title||"")+" "+(document.body?document.body.innerText.slice(0,400):"")).toLowerCase();'
    + 'if(/just a moment|checking your browser|verifying you are (a )?human|needs to review the security|attention required|cloudflare|turnstile|check_bot|enable javascript and cookies/.test(hay))return "challenge";'
    + 'if(document.querySelector(\'iframe[src*="challenges.cloudflare.com"],iframe[src*="turnstile"],iframe[title*="loudflare"],iframe[title*="hallenge"]\'))return "challenge";'
    + 'var b=document.body?document.body.innerText.replace(/\\s+/g,""):"";'
    + 'if(b.length<8&&document.querySelectorAll("iframe").length===0)return "blank";'
    + 'return "other";'
    + '}catch(e){return "error";}})()';
}

/**
 * Build a self-contained string of JS to run in the sign-in page.
 *
 * The live form sits behind Cloudflare, so we can't hard-code its exact field
 * names — detection is heuristic: password by input[type=password]; the
 * login/email field by input[type=email] → a name/id/placeholder hint → the
 * visible text input just before the password box. Values are written via the
 * native value setter + input/change events so any client-side validation or
 * framework-controlled input notices the change.
 *
 * When `submit` is true, after filling it finds the form's Sign-in control
 * (button/input[type=submit] → a button whose label matches log in/sign in/
 * connexion/valider/…) and clicks it; falling back to form.requestSubmit().
 *
 * Returns a marker string when run: "submitted", "filled:login+password",
 * "filled:…:no-submit-btn", "no-creds", "no-form", "no-fields", or "waiting"
 * (form not in the DOM yet — it retries in-page). Credentials are embedded with
 * JSON.stringify, so quotes/backslashes in a password can't break the string or
 * inject script.
 */
function buildLoginAutofillScript(email, password, submit) {
  return '(function(){'
    + 'var EMAIL=' + JSON.stringify(email || '') + ',PASS=' + JSON.stringify(password || '')
    + ',SUBMIT=' + (submit ? 'true' : 'false') + ';'
    + 'if(!EMAIL&&!PASS)return "no-creds";'
    + 'function setVal(el,val){try{var p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;'
    + 'var s=Object.getOwnPropertyDescriptor(p,"value").set;s.call(el,val);'
    + 'el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}catch(e){el.value=val;}}'
    + 'function visible(el){return !!(el.offsetParent||el.getClientRects().length);}'
    + 'function textInputs(){var all=Array.prototype.slice.call(document.querySelectorAll("input"));'
    + 'return all.filter(function(i){var t=(i.type||"text").toLowerCase();'
    + 'return["password","hidden","submit","checkbox","radio","button","file","image","reset"].indexOf(t)<0&&visible(i);});}'
    + 'function pickLogin(pw){'
    + 'var byType=document.querySelector(\'input[type="email"]\');if(byType&&visible(byType))return byType;'
    + 'var text=textInputs();'
    + 'var hint=text.filter(function(i){var s=((i.name||"")+" "+(i.id||"")+" "+(i.placeholder||"")+" "+(i.autocomplete||"")).toLowerCase();'
    + 'return /e-?mail|login|user|pseudo|ident|compte|account|nom/.test(s);});'
    + 'if(hint.length)return hint[0];'
    + 'if(pw){var before=text.filter(function(i){return i.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING;});'
    + 'if(before.length)return before[before.length-1];}'
    + 'return text[0]||null;}'
    + 'function findSubmit(form){var scope=form||document;'
    + 'var explicit=scope.querySelector(\'button[type="submit"],input[type="submit"],input[type="image"]\');if(explicit)return explicit;'
    + 'var cands=Array.prototype.slice.call(scope.querySelectorAll(\'button,input[type="button"]\'));'
    + 'var re=/log\\s?[- ]?in|sign\\s?[- ]?in|connexion|se connecter|connect|valider|envoyer|submit|enter|ok/i;'
    + 'for(var i=0;i<cands.length;i++){var c=cands[i];'
    + 'var s=((c.textContent||"")+" "+(c.value||"")+" "+((c.getAttribute&&c.getAttribute("aria-label"))||"")+" "+(c.title||"")).trim();'
    + 'if(re.test(s))return c;}'
    + 'return scope.querySelector(\'button,input[type="submit"]\');}'
    + 'var tries=0;function attempt(){'
    + 'var pw=document.querySelector(\'input[type="password"]\');var login=pickLogin(pw);'
    + 'if(!pw&&!login){if(tries++<20){setTimeout(attempt,200);return "waiting";}return "no-form";}'
    + 'var did=[];if(login&&EMAIL){setVal(login,EMAIL);did.push("login");}'
    + 'if(pw&&PASS){setVal(pw,PASS);did.push("password");}'
    + 'if(!did.length)return "no-fields";'
    + 'if(SUBMIT){var form=(login&&login.form)||(pw&&pw.form)||null;var btn=findSubmit(form);'
    + 'if(btn&&btn.click){btn.click();return "submitted";}'
    + 'if(form&&form.requestSubmit){form.requestSubmit();return "submitted";}'
    + 'if(form&&form.submit){form.submit();return "submitted";}'
    + 'return "filled:"+did.join("+")+":no-submit-btn";}'
    + 'return "filled:"+did.join("+");}'
    + 'return attempt();'
    + '})()';
}

module.exports = {
  LOGIN_PATH, LIMIT_PATH, isLoginUrl, isLimitUrl, loginUrlFor,
  isLoggedInProfileUrl, buildLoginPageProbeScript, buildLoginAutofillScript,
};

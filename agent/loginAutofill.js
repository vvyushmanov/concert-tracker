/*
 * loginAutofill.js — pure helpers for auto-filling concerts-metal's sign-in form.
 *
 * Kept Electron-free (like scraper.buildPageUrl) so it's unit-testable on plain
 * node. main.js owns the wiring: it listens for the scraper window settling on
 * login.html and injects buildLoginAutofillScript(...) into that page.
 *
 * We FILL only (never auto-submit) — the user stays in control of the actual
 * login, so any "remember me" / extra step on the page keeps working.
 */

const LOGIN_PATH = '/login.html';

/** True when `u` is concerts-metal's sign-in page (any host/scheme). */
function isLoginUrl(u) {
  try { return new URL(u).pathname.toLowerCase().endsWith(LOGIN_PATH); }
  catch { return false; }
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
 * Returns a marker string when run: "filled:login+password", "no-creds",
 * "no-form", "no-fields", or "waiting" (form not in the DOM yet — it retries
 * in-page). Credentials are embedded with JSON.stringify, so quotes/backslashes
 * in a password can't break out of the string or inject script.
 */
function buildLoginAutofillScript(email, password) {
  return '(function(){'
    + 'var EMAIL=' + JSON.stringify(email || '') + ',PASS=' + JSON.stringify(password || '') + ';'
    + 'if(!EMAIL&&!PASS)return "no-creds";'
    + 'function setVal(el,val){try{var p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;'
    + 'var s=Object.getOwnPropertyDescriptor(p,"value").set;s.call(el,val);'
    + 'el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}catch(e){el.value=val;}}'
    + 'function visible(el){return !!(el.offsetParent||el.getClientRects().length);}'
    + 'function pickLogin(pw){'
    + 'var byType=document.querySelector(\'input[type="email"]\');if(byType&&visible(byType))return byType;'
    + 'var all=Array.prototype.slice.call(document.querySelectorAll("input"));'
    + 'var text=all.filter(function(i){var t=(i.type||"text").toLowerCase();'
    + 'return["password","hidden","submit","checkbox","radio","button","file","image","reset"].indexOf(t)<0&&visible(i);});'
    + 'var hint=text.filter(function(i){var s=((i.name||"")+" "+(i.id||"")+" "+(i.placeholder||"")+" "+(i.autocomplete||"")).toLowerCase();'
    + 'return /e-?mail|login|user|pseudo|ident|compte|account|nom/.test(s);});'
    + 'if(hint.length)return hint[0];'
    + 'if(pw){var before=text.filter(function(i){return i.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING;});'
    + 'if(before.length)return before[before.length-1];}'
    + 'return text[0]||null;}'
    + 'var tries=0;function attempt(){'
    + 'var pw=document.querySelector(\'input[type="password"]\');var login=pickLogin(pw);'
    + 'if(!pw&&!login){if(tries++<20){setTimeout(attempt,200);return "waiting";}return "no-form";}'
    + 'var did=[];if(login&&EMAIL){setVal(login,EMAIL);did.push("login");}'
    + 'if(pw&&PASS){setVal(pw,PASS);did.push("password");}'
    + 'return did.length?("filled:"+did.join("+")):"no-fields";}'
    + 'return attempt();'
    + '})()';
}

module.exports = { LOGIN_PATH, isLoginUrl, buildLoginAutofillScript };

/*
 * settings.js — renderer for the tabbed Settings window (settings.html).
 *
 * Talks to main ONLY through window.agent (preload.js): getConfig / saveConfig.
 * Country name↔code resolution is pure and runs in-page via window.CM_COUNTRIES
 * (countries.js, loaded as a plain <script> before this one). No Node here
 * (contextIsolation on, sandboxed).
 *
 * The Countries widget is a ROSTER with per-country active toggles, mirroring the
 * backend's notion of an "active" flag separate from membership:
 *   • a ticked row  → its code goes into cfg.countries (the crawl set)
 *   • an unticked row → kept in cfg.countryRoster but left OUT of cfg.countries
 *   • ✕ → dropped from both
 * config.load() reconciles the pair on the main side (see countries.js).
 */
'use strict';

const $ = (id) => document.getElementById(id);
const CC = window.CM_COUNTRIES; // { resolveCountry, countryName, allCountries, ... }

const els = {
  ingestUrl: $('ingestUrl'),
  ingestToken: $('ingestToken'),
  loginEmail: $('loginEmail'),
  loginPassword: $('loginPassword'),
  loginMode: $('loginMode'),
  loginSuccessMarker: $('loginSuccessMarker'),
  maxPages: $('maxPages'),
  runsPerDay: $('runsPerDay'),
  autoStart: $('autoStartOnLaunch'),
  ccInput: $('cc-input'),
  ccList: $('cc-list'),
  ccAddBtn: $('cc-add-btn'),
  ccRoster: $('cc-roster'),
  save: $('save'),
  close: $('close'),
  toast: $('toast'),
};

// Local working copy of the roster: [{ code, name, active }]. The single source
// of truth for the widget; serialized to {countries, countryRoster} on save.
let roster = [];

let toastTimer = null;
function toast(msg, isErr = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('err', !!isErr);
  els.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

// ── tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  });
});

// ── countries roster ──────────────────────────────────────────────────────────
function renderRoster() {
  els.ccRoster.innerHTML = '';
  if (!roster.length) {
    const empty = document.createElement('div');
    empty.className = 'cc-empty';
    empty.textContent = 'No countries yet — add one above.';
    els.ccRoster.appendChild(empty);
    return;
  }
  for (const entry of roster) {
    const row = document.createElement('div');
    row.className = 'cc-row' + (entry.active ? '' : ' inactive');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'cc-active';
    cb.checked = entry.active;
    cb.title = entry.active ? 'Included in crawls' : 'Skipped';
    cb.addEventListener('change', () => { entry.active = cb.checked; renderRoster(); });

    const badge = document.createElement('span');
    badge.className = 'cc-badge';
    badge.textContent = entry.code;

    const name = document.createElement('span');
    name.className = 'cc-name';
    name.textContent = entry.name;
    if (!entry.active) {
      const skip = document.createElement('span');
      skip.className = 'cc-skip';
      skip.textContent = '  (skipped)';
      name.appendChild(skip);
    }

    const rm = document.createElement('span');
    rm.className = 'cc-rm';
    rm.title = `Remove ${entry.name}`;
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      roster = roster.filter((e) => e.code !== entry.code);
      renderRoster();
    });

    row.append(cb, badge, name, rm);
    els.ccRoster.appendChild(row);
  }
}

function addCountry() {
  const raw = els.ccInput.value.trim();
  if (!raw) return;
  const hit = CC && CC.resolveCountry(raw);
  if (!hit) {
    toast(`"${raw}" isn't a country I recognise — try a name (Turkey) or ISO code (tr).`, true);
    return;
  }
  const existing = roster.find((e) => e.code === hit.code);
  if (existing) {
    // Already present — just make sure it's active and flag it for the user.
    if (!existing.active) { existing.active = true; renderRoster(); toast(`${hit.name} re-enabled`); }
    else toast(`${hit.name} is already in the list`);
    els.ccInput.value = '';
    return;
  }
  roster.push({ code: hit.code, name: hit.name, active: true });
  renderRoster();
  els.ccInput.value = '';
  els.ccInput.focus();
}

els.ccAddBtn.addEventListener('click', addCountry);
els.ccInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addCountry(); }
});

function populateDatalist() {
  if (!CC || !els.ccList) return;
  const frag = document.createDocumentFragment();
  for (const { code, name } of CC.allCountries()) {
    const opt = document.createElement('option');
    opt.value = name;            // inserted into the input on pick → resolves by name
    opt.label = code.toUpperCase();
    frag.appendChild(opt);
  }
  els.ccList.appendChild(frag);
}

// ── password show/hide ──────────────────────────────────────────────────────
function wireReveal(btnId, inputEl) {
  $(btnId).addEventListener('click', (e) => {
    const hidden = inputEl.type === 'password';
    inputEl.type = hidden ? 'text' : 'password';
    e.target.textContent = hidden ? 'Hide' : 'Show';
  });
}
wireReveal('toggle-token', els.ingestToken);
wireReveal('toggle-loginPassword', els.loginPassword);

// ── load / gather / save ──────────────────────────────────────────────────────
async function loadConfig() {
  const c = await window.agent.getConfig();
  els.ingestUrl.value = c.ingestUrl || '';
  els.ingestToken.value = c.ingestToken || '';
  els.loginEmail.value = c.loginEmail || '';
  els.loginPassword.value = c.loginPassword || '';
  els.loginMode.value = ['auto', 'fill', 'off'].includes(c.loginMode) ? c.loginMode : 'auto';
  els.loginSuccessMarker.value = c.loginSuccessMarker || '';
  els.maxPages.value = c.maxPages != null ? c.maxPages : 3;
  els.runsPerDay.value = String(c.runsPerDay != null ? c.runsPerDay : 2);
  els.autoStart.checked = !!c.autoStartOnLaunch;

  // Roster = the full list; active = membership in cfg.countries.
  const activeCodes = new Set((c.countries || []).map((s) => String(s).toLowerCase()));
  roster = (c.countryRoster || []).map(({ code, name }) => ({
    code: String(code).toLowerCase(),
    name: name || (CC ? CC.countryName(code) : String(code).toUpperCase()),
    active: activeCodes.has(String(code).toLowerCase()),
  }));
  renderRoster();
}

function gatherConfig() {
  return {
    ingestUrl: els.ingestUrl.value.trim(),
    ingestToken: els.ingestToken.value.trim(),
    loginEmail: els.loginEmail.value.trim(),
    loginPassword: els.loginPassword.value,
    loginMode: els.loginMode.value,
    loginSuccessMarker: els.loginSuccessMarker.value.trim(),
    // Active codes drive the crawl; the roster remembers de-selected ones too.
    countries: roster.filter((e) => e.active).map((e) => e.code),
    countryRoster: roster.map((e) => ({ code: e.code, name: e.name })),
    maxPages: Math.max(1, parseInt(els.maxPages.value, 10) || 3),
    runsPerDay: parseInt(els.runsPerDay.value, 10) || 0,
    autoStartOnLaunch: els.autoStart.checked,
  };
}

els.save.addEventListener('click', async () => {
  els.save.disabled = true;
  try {
    await window.agent.saveConfig(gatherConfig());
    const n = roster.filter((e) => e.active).length;
    toast(`Settings saved · ${n} ${n === 1 ? 'country' : 'countries'} active`);
  } catch (e) {
    toast('Save failed: ' + e.message, true);
  } finally {
    els.save.disabled = false;
  }
});

els.close.addEventListener('click', () => window.close());

// ── init ──────────────────────────────────────────────────────────────────────
populateDatalist();
loadConfig().catch((e) => toast('Could not load settings: ' + e.message, true));

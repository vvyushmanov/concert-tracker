/*
 * countries.js — pure country code↔name helpers, shared by the Electron MAIN
 * process (config.js `require`s it) and the SETTINGS renderer (loaded as a plain
 * <script>, where it publishes window.CM_COUNTRIES). No Node, no Electron, no
 * network — so it's unit-testable and works inside the sandboxed renderer.
 *
 * The code↔name table is built ONCE at module load from the platform's own ICU
 * (Intl.DisplayNames), brute-forcing AA–ZZ with fallback:'none' so only assigned
 * ISO 3166 / CLDR territories survive. That means the names we resolve are
 * exactly the names this platform's Intl can produce — nothing to keep in sync.
 *
 * concerts-metal.com country pages are keyed by ISO alpha-2 code (next_<cc>_…),
 * so resolving a typed name → code is all the scraper needs; `cfg.countries`
 * stays a flat list of active codes (see config.js).
 */

// Normalize a name/typed string for fuzzy matching: drop diacritics, lowercase,
// strip everything non-alphanumeric. "Türkiye" → "turkiye", "United States" →
// "unitedstates".
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// ICU also names codes that are NOT current ISO 3166-1 countries: codes
// deprecated in favour of a successor (which ICU collapses onto the SAME name,
// e.g. dd→"Germany", uk→"United Kingdom", su→"Russia"), and CLDR/exceptional
// "special" codes (zz "Unknown Region", eu "European Union", …). Left in, the
// deprecated ones would even WIN a name lookup by alphabetical order (dd < de),
// so a typed "Germany" could resolve to dd. Drop them all; what remains is the
// canonical country set. (aq Antarctica / um U.S. Outlying Islands ARE real ISO
// 3166-1 codes — kept.) Derived by inspecting the platform's own ICU output.
const DENY = new Set([
  // deprecated codes whose ICU name duplicates the current code's
  'an', 'hv', 'dy', 'bu', 'zr', 'cs', 'yu', 'dd', 'fx', 'uk', 'nh', 'rh', 'su', 'tp', 'vd', 'yd',
  // exceptional / macro / placeholder codes (not ISO 3166-1 countries)
  'ac', 'cp', 'dg', 'ea', 'eu', 'ez', 'ic', 'qo', 'ta', 'un', 'zz',
]);

const CODE_TO_NAME = {};  // 'fr' → 'France'
const NORM_TO_CODE = {};  // 'france' → 'fr'  (first/alphabetically-canonical code wins)

(function buildTable() {
  let dn = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }); }
  catch { dn = null; }
  if (!dn) return; // no ICU region data → resolver degrades to code-only (rare)
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      const lc = code.toLowerCase();
      if (DENY.has(lc)) continue;
      let name;
      try { name = dn.of(code); } catch { name = undefined; }
      if (!name || name === code) continue; // unassigned (fallback:'none' → undefined)
      CODE_TO_NAME[lc] = name;
      const key = normName(name);
      // Iterating AA→ZZ alphabetically means the canonical ISO code wins a name
      // collision (e.g. 'gb' before the CLDR alias 'uk' → "United Kingdom" → gb).
      if (key && !(key in NORM_TO_CODE)) NORM_TO_CODE[key] = lc;
    }
  }
})();

// Common ways people type a country that don't match its ICU name by prefix or
// substring (so the fuzzy fallback can't catch them). Keys are normName()-keyed.
const ALIASES = {
  turkey: 'tr', turkiye: 'tr',
  usa: 'us', america: 'us', unitedstatesofamerica: 'us',
  uk: 'gb', greatbritain: 'gb', britain: 'gb', england: 'gb',
  holland: 'nl',
  czechrepublic: 'cz',
  ivorycoast: 'ci',
  swaziland: 'sz',
  capeverde: 'cv',
  burma: 'mm',
};

/**
 * Resolve a user-typed country (an ISO alpha-2 code OR a full/partial name) to a
 * canonical { code, name }. Returns null if it can't be resolved unambiguously.
 */
function resolveCountry(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Explicit 2-letter code (the common case for codes like fr/ge/de/tr).
  if (/^[a-z]{2}$/i.test(raw)) {
    const code = raw.toLowerCase();
    if (CODE_TO_NAME[code]) return { code, name: CODE_TO_NAME[code] };
    // A 2-letter string that isn't a known code: fall through to name matching.
  }

  const key = normName(raw);
  if (!key) return null;

  if (ALIASES[key] && CODE_TO_NAME[ALIASES[key]]) {
    const code = ALIASES[key];
    return { code, name: CODE_TO_NAME[code] };
  }
  if (NORM_TO_CODE[key]) {
    const code = NORM_TO_CODE[key];
    return { code, name: CODE_TO_NAME[code] };
  }
  // Fuzzy: accept only an UNAMBIGUOUS prefix, then an unambiguous substring.
  // Gated to ≥3 chars — a 1–2 char query is either a code (handled above) or far
  // too ambiguous (e.g. "zz" is a substring of "Braz‑zz‑aville").
  if (key.length < 3) return null;
  const keys = Object.keys(NORM_TO_CODE);
  const starts = keys.filter((k) => k.startsWith(key));
  if (starts.length === 1) {
    const code = NORM_TO_CODE[starts[0]];
    return { code, name: CODE_TO_NAME[code] };
  }
  const incl = keys.filter((k) => k.includes(key));
  if (incl.length === 1) {
    const code = NORM_TO_CODE[incl[0]];
    return { code, name: CODE_TO_NAME[code] };
  }
  return null;
}

/** Display name for a code, falling back to the upper-cased code if unknown. */
function countryName(code) {
  const lc = String(code || '').trim().toLowerCase();
  return CODE_TO_NAME[lc] || lc.toUpperCase();
}

/** All known { code, name } sorted by name — for an autocomplete datalist. */
function allCountries() {
  return Object.keys(CODE_TO_NAME)
    .map((code) => ({ code, name: CODE_TO_NAME[code] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reconcile the two persisted country fields into a coherent pair (pure — no
 * Electron, so config.js and the tests both use it):
 *   • countries     — ACTIVE codes the crawl consumes (scraper reads these).
 *   • countryRoster — the full [{code,name}] list incl. de-selected entries.
 * Invariants enforced: roster is de-duped {code,name} (names filled from ICU when
 * missing); every active code appears in the roster; both are lower-cased. Legacy
 * configs (countries only) and env (CM_COUNTRIES) derive a roster automatically.
 */
function normalizeCountryState(rawCountries, rawRoster) {
  const roster = [];
  const inRoster = new Set();
  const addToRoster = (code, name) => {
    const lc = String(code || '').trim().toLowerCase();
    if (!lc || inRoster.has(lc)) return;
    inRoster.add(lc);
    roster.push({ code: lc, name: (name && String(name).trim()) || countryName(lc) });
  };
  if (Array.isArray(rawRoster)) {
    for (const item of rawRoster) {
      if (item && typeof item === 'object') addToRoster(item.code, item.name);
      else if (typeof item === 'string') addToRoster(item);
    }
  }

  const countries = [];
  const active = new Set();
  if (Array.isArray(rawCountries)) {
    for (const c of rawCountries) {
      const lc = String(c || '').trim().toLowerCase();
      if (!lc || active.has(lc)) continue;
      active.add(lc);
      countries.push(lc);
      addToRoster(lc); // an active code must always be present in the roster
    }
  }
  return { countries, countryRoster: roster };
}

const api = {
  resolveCountry, countryName, allCountries, normalizeCountryState,
  // exposed for tests/inspection
  _normName: normName,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;      // CommonJS (main process)
if (typeof window !== 'undefined') window.CM_COUNTRIES = api;                     // classic <script> (renderer)

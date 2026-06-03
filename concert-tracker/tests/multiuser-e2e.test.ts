/**
 * M1.6 — Multi-user read-time personalization, end-to-end proof.
 *
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/multiuser-e2e.test.ts
 *
 * Builds an ISOLATED global concert graph (no scraping, no geocoding — rows are
 * created directly) and proves the invariants the whole M1 model rests on:
 *
 *   1. DISJOINT VIEWS — two users with different active countries + followed
 *      artists see disjoint, correct, NON-EMPTY subsets of the SAME global
 *      concerts. A concert followed by neither is invisible to both, and a
 *      synthetic user NEVER sees a non-test (real) concert (anti-leak).
 *   2. PREFS CHANGE WITHOUT RE-SCRAPE — following/unfollowing an artist and
 *      activating/deactivating a country instantly change what a user sees, with
 *      ZERO writes to the (test-owned) Concert/Artist/ArtistConcert rows. Includes
 *      the empty-active-country fallback (no countries → artist-gated, all countries).
 *   3. USERCONCERT = PURE USER-STATE — marking interested upserts a UserConcert
 *      row; unfollowing the artist removes the concert from the relevant list but
 *      the interest row PERSISTS; re-following brings it back with interest intact.
 *
 * Plus targeted helper-branch coverage flagged by adversarial review:
 *   4. non-primary co-performer relevance + primary-artist convenience field,
 *   5. upcomingOnly date gate (past concerts excluded unless upcomingOnly:false),
 *   6. artistIds intersection (incl. empty-intersection early return),
 *   7. empty-followed-set early return.
 *
 * Hardening: all test rows are prefixed `__test_m16_`; an idempotent PREFIX-scoped
 * wipe() runs BEFORE (self-heal after a crashed run) and AFTER; the global-count
 * snapshot is scoped to test-owned rows so a concurrent scan can't cause a false FAIL.
 *
 * Base graph:
 *   Country CX            Country CY
 *   ├─ X1 ← A1            ├─ Y1 ← B1
 *   ├─ X2 ← A2            └─ SY ← C1   (C1 shared across CX & CY)
 *   └─ SX ← C1
 *   U1: active=[CX], follows {A1, C1}  → expects {X1, SX}
 *   U2: active=[CY], follows {B1, C1}  → expects {Y1, SY}
 *   X2 (A2): followed by neither       → invisible to both
 */
import { prisma } from '@/lib/prisma';
import { getRelevantConcerts } from '@/lib/concerts';

const P = '__test_m16_';
const now = Math.floor(Date.now() / 1000);
const future = now + 30 * 24 * 3600;
const past = now - 30 * 24 * 3600;

let passed = 0;
let failed = 0;
const check = (c: boolean, m: string) => {
  c ? passed++ : failed++;
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
  return c;
};

const URL = {
  X1: P + 'X1', X2: P + 'X2', Y1: P + 'Y1', SX: P + 'SX', SY: P + 'SY',
  MX: P + 'MX', X1past: P + 'X1past',
};

/** Full relevant result for a user (default opts). */
async function rel(userId: number, opts = {}) {
  return getRelevantConcerts(userId, opts);
}
/** Set of test-event urls a user currently sees as relevant. */
async function relevantUrls(userId: number, opts = {}): Promise<Set<string>> {
  const { concerts } = await rel(userId, opts);
  return new Set(concerts.map((c: any) => c.eventUrl).filter((u: string) => u.startsWith(P)));
}
const eq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
const short = (s: Set<string>) => [...s].map((u) => u.replace(P, '')).join(', ');

/** Global-table snapshot SCOPED to test-owned rows (robust on a shared/live DB). */
async function testRowCounts() {
  const [concert, artist, artistConcert] = await Promise.all([
    prisma.concert.count({ where: { eventUrl: { startsWith: P } } }),
    prisma.artist.count({ where: { name: { startsWith: P } } }),
    prisma.artistConcert.count({ where: { concert: { eventUrl: { startsWith: P } } } }),
  ]);
  return { concert, artist, artistConcert };
}

// ---- builders -------------------------------------------------------------
async function makeCountry(name: string, code: string) {
  const c = await prisma.country.create({ data: { name: P + name, code, active: true, createdAt: now, updatedAt: now } });
  const cn = await prisma.cityNormalized.create({ data: { normalizedCity: P + name.toLowerCase(), countryId: c.id, createdAt: now, updatedAt: now } });
  const cm = await prisma.cityMapping.create({ data: { originalCity: P + name + 'City', countryId: c.id, cityNormalizedId: cn.id, source: 'manual', createdAt: now, updatedAt: now } });
  return { country: c, cityMapping: cm };
}
async function makeArtist(name: string) {
  return prisma.artist.create({ data: { name: P + name, createdAt: now, updatedAt: now } });
}
async function makeConcert(
  eventUrl: string,
  country: { id: number },
  cityMapping: { id: number },
  performers: Array<{ artist: { id: number }; isPrimary: boolean }>,
  dateStart = future
) {
  const c = await prisma.concert.create({
    data: {
      eventName: eventUrl + ' event', eventUrl, dateStart, dateEnd: dateStart, venue: P + 'venue',
      cityMappingId: cityMapping.id, countryId: country.id,
      performers: JSON.stringify([P + 'perf']), ticketLinks: JSON.stringify([]),
      createdAt: now, updatedAt: now,
    },
  });
  for (const p of performers) {
    await prisma.artistConcert.create({ data: { artistId: p.artist.id, concertId: c.id, isPrimary: p.isPrimary, createdAt: now, updatedAt: now } });
  }
  return c;
}
async function makeUser(name: string) {
  return prisma.user.create({ data: { username: P + name, hashedPassword: 'x', role: 'USER', createdAt: now, updatedAt: now } });
}
const follow = (userId: number, artistId: number) =>
  prisma.userArtist.create({ data: { userId, artistId, playcount: 10, playcount12month: 5, recent: true, createdAt: now, updatedAt: now } });
const unfollow = (userId: number, artistId: number) => prisma.userArtist.deleteMany({ where: { userId, artistId } });
const activate = (userId: number, countryId: number) => prisma.userActiveCountry.create({ data: { userId, countryId, createdAt: now, updatedAt: now } });
const deactivate = (userId: number, countryId: number) => prisma.userActiveCountry.deleteMany({ where: { userId, countryId } });

/** Idempotent, PREFIX-scoped, FK-ordered cleanup. Safe before AND after a run. */
async function wipe() {
  await prisma.artistConcert.deleteMany({ where: { OR: [{ concert: { eventUrl: { startsWith: P } } }, { artist: { name: { startsWith: P } } }] } });
  await prisma.userConcert.deleteMany({ where: { OR: [{ concert: { eventUrl: { startsWith: P } } }, { user: { username: { startsWith: P } } }] } });
  await prisma.userArtist.deleteMany({ where: { OR: [{ artist: { name: { startsWith: P } } }, { user: { username: { startsWith: P } } }] } });
  await prisma.userActiveCountry.deleteMany({ where: { OR: [{ country: { name: { startsWith: P } } }, { user: { username: { startsWith: P } } }] } });
  await prisma.concert.deleteMany({ where: { eventUrl: { startsWith: P } } });
  await prisma.cityMapping.deleteMany({ where: { originalCity: { startsWith: P } } });
  await prisma.cityNormalized.deleteMany({ where: { normalizedCity: { startsWith: P } } });
  await prisma.country.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.artist.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
}

async function main() {
  await wipe(); // self-heal any orphans from a previously crashed run

  // ---- base graph --------------------------------------------------------
  const { country: CX, cityMapping: cmX } = await makeCountry('X', 'q1');
  const { country: CY, cityMapping: cmY } = await makeCountry('Y', 'q2');
  const A1 = await makeArtist('A1');
  const A2 = await makeArtist('A2');
  const B1 = await makeArtist('B1');
  const C1 = await makeArtist('C1');

  await makeConcert(URL.X1, CX, cmX, [{ artist: A1, isPrimary: true }]);
  await makeConcert(URL.X2, CX, cmX, [{ artist: A2, isPrimary: true }]);
  await makeConcert(URL.Y1, CY, cmY, [{ artist: B1, isPrimary: true }]);
  await makeConcert(URL.SX, CX, cmX, [{ artist: C1, isPrimary: true }]);
  await makeConcert(URL.SY, CY, cmY, [{ artist: C1, isPrimary: true }]);

  const u1 = await makeUser('u1');
  const u2 = await makeUser('u2');
  await activate(u1.id, CX.id); await follow(u1.id, A1.id); await follow(u1.id, C1.id);
  await activate(u2.id, CY.id); await follow(u2.id, B1.id); await follow(u2.id, C1.id);

  // ---- 1. DISJOINT VIEWS + ANTI-LEAK -------------------------------------
  console.log('\n— 1. Disjoint multi-user views from the same global concerts —');
  const v1 = await relevantUrls(u1.id);
  const v2 = await relevantUrls(u2.id);
  check(eq(v1, [URL.X1, URL.SX]), `U1 sees exactly {X1, SX} (got {${short(v1)}})`);
  check(eq(v2, [URL.Y1, URL.SY]), `U2 sees exactly {Y1, SY} (got {${short(v2)}})`);
  check(v1.size > 0 && v2.size > 0, 'both views are NON-empty (guards against vacuous disjointness)');
  check([...v1].every((u) => !v2.has(u)), 'views are disjoint (no shared concert)');
  check(!v1.has(URL.X2) && !v2.has(URL.X2), 'X2 (followed by neither) is invisible to BOTH — global storage ≠ visibility');
  check(!v1.has(URL.SY), 'U1 does NOT see SY (C1 followed but CY not active) — country gating works');
  check(!v2.has(URL.SX), 'U2 does NOT see SX (C1 followed but CX not active)');
  // anti-leak: a synthetic user must NEVER receive a real (non-test) concert.
  const r1all = await rel(u1.id);
  const r2all = await rel(u2.id);
  check(r1all.concerts.every((c: any) => c.eventUrl.startsWith(P)), 'U1 result contains ONLY test concerts (no real-data leak past the artist/country gate)');
  check(r2all.concerts.every((c: any) => c.eventUrl.startsWith(P)), 'U2 result contains ONLY test concerts');

  // ---- 1b. artistIds intersection ----------------------------------------
  console.log('\n— 1b. artistIds option is intersected with the followed set —');
  check(eq(await relevantUrls(u1.id, { artistIds: [C1.id] }), [URL.SX]), 'U1 + artistIds=[C1] → only {SX} (A1 filtered out, country still gates)');
  check((await relevantUrls(u1.id, { artistIds: [B1.id] })).size === 0, 'U1 + artistIds=[B1] (not followed) → empty (empty-intersection early return)');

  // ---- 2. PREFS CHANGE WITHOUT RE-SCRAPE ---------------------------------
  console.log('\n— 2. Preferences change the view instantly, with no re-scrape —');
  const before = await testRowCounts();

  await follow(u1.id, A2.id);
  check((await relevantUrls(u1.id)).has(URL.X2), 'following A2 → U1 now sees X2');
  await unfollow(u1.id, A2.id);
  check(!(await relevantUrls(u1.id)).has(URL.X2), 'unfollowing A2 → X2 gone again');

  await activate(u1.id, CY.id);
  const v1cy = await relevantUrls(u1.id);
  check(v1cy.has(URL.SY), 'activating CY → U1 now sees SY (C1 in CY)');
  check(!v1cy.has(URL.Y1), 'but U1 still does NOT see Y1 (B1 not followed) — artist gate still applies');
  await deactivate(u1.id, CY.id);
  check(!(await relevantUrls(u1.id)).has(URL.SY), 'deactivating CY → SY gone again');

  // empty-active-country fallback: no active countries → artist-gated across ALL countries.
  await deactivate(u1.id, CX.id);
  const vNoCountry = await relevantUrls(u1.id);
  check(eq(vNoCountry, [URL.X1, URL.SX, URL.SY]), `no active countries → unrestricted-by-country, still artist-gated → {X1, SX, SY} (got {${short(vNoCountry)}})`);
  check((await rel(u1.id)).concerts.every((c: any) => c.eventUrl.startsWith(P)), 'even unrestricted-by-country, U1 still sees ONLY test concerts (followed set is all test artists)');
  await activate(u1.id, CX.id);
  check(eq(await relevantUrls(u1.id), [URL.X1, URL.SX]), 're-activating CX → back to {X1, SX}');

  const after = await testRowCounts();
  check(
    before.concert === after.concert && before.artist === after.artist && before.artistConcert === after.artistConcert,
    `test-owned global rows UNCHANGED by pref edits (Concert ${before.concert}→${after.concert}, Artist ${before.artist}→${after.artist}, ArtistConcert ${before.artistConcert}→${after.artistConcert})`
  );

  // ---- 3. USERCONCERT = PURE USER-STATE ----------------------------------
  console.log('\n— 3. UserConcert is pure user-state, independent of relevance —');
  const x1 = await prisma.concert.findUnique({ where: { eventUrl: URL.X1 } });
  await prisma.userConcert.upsert({
    where: { userId_concertId: { userId: u1.id, concertId: x1!.id } },
    update: { interested: true, updatedAt: now },
    create: { userId: u1.id, concertId: x1!.id, interested: true, createdAt: now, updatedAt: now },
  });
  const x1row = (await rel(u1.id)).concerts.find((c: any) => c.eventUrl === URL.X1);
  check(!!x1row && x1row.interested === true, 'marked interested → X1 shows interested=true in the relevant list');

  await unfollow(u1.id, A1.id);
  check(!(await relevantUrls(u1.id)).has(URL.X1), 'after unfollowing A1, X1 leaves U1’s relevant list');
  const persisted = await prisma.userConcert.findUnique({ where: { userId_concertId: { userId: u1.id, concertId: x1!.id } } });
  check(!!persisted && persisted.interested === true, 'UserConcert interest row PERSISTS even though the concert is no longer relevant');

  await follow(u1.id, A1.id);
  const x1again = (await rel(u1.id)).concerts.find((c: any) => c.eventUrl === URL.X1);
  check(!!x1again && x1again.interested === true, 're-following A1 → X1 returns with interest still true');

  // ---- 4. NON-PRIMARY CO-PERFORMER RELEVANCE -----------------------------
  console.log('\n— 4. Relevance via a non-primary co-performer; primary-artist convenience field —');
  const D1 = await makeArtist('D1'); // headliner, NOT followed by U1
  await makeConcert(URL.MX, CX, cmX, [{ artist: D1, isPrimary: true }, { artist: A1, isPrimary: false }]);
  const mx = (await rel(u1.id)).concerts.find((c: any) => c.eventUrl === URL.MX);
  check(!!mx, 'MX is relevant to U1 via the non-primary co-performer A1');
  const a1e = mx?.artists.find((a: any) => a.artist.name === P + 'A1');
  const d1e = mx?.artists.find((a: any) => a.artist.name === P + 'D1');
  check(a1e?.artist.followed === true && d1e?.artist.followed === false, 'per-artist followed flags correct (A1 followed, D1 not)');
  check(d1e?.isPrimary === true && a1e?.isPrimary === false, 'isPrimary preserved (D1 headliner, A1 co-performer)');
  check(mx?.artist?.name === P + 'D1' && mx?.artist?.followed === false, 'primary-artist convenience field is the headliner D1 even though U1 follows A1, not D1');

  // ---- 5. upcomingOnly DATE GATE -----------------------------------------
  console.log('\n— 5. upcomingOnly date gate —');
  await makeConcert(URL.X1past, CX, cmX, [{ artist: A1, isPrimary: true }], past);
  check(!(await relevantUrls(u1.id)).has(URL.X1past), 'past concert excluded by default (upcomingOnly=true)');
  check((await relevantUrls(u1.id, { upcomingOnly: false })).has(URL.X1past), 'past concert INCLUDED with upcomingOnly:false');

  // ---- 6. empty-followed-set early return --------------------------------
  console.log('\n— 6. A user following nobody sees nothing —');
  const u3 = await makeUser('u3');
  await activate(u3.id, CX.id); // active country, but follows no artists
  const r3 = await rel(u3.id);
  check(r3.concerts.length === 0 && r3.followedArtistIds.length === 0, 'follows nobody → empty relevant set (early return), despite having an active country');
}

main()
  .then(async () => {
    await wipe();
    await prisma.$disconnect();
    console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    try { await wipe(); } catch {}
    await prisma.$disconnect();
    process.exit(1);
  });

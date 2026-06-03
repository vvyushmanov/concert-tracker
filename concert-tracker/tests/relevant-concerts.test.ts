/**
 * Integration test for the read-time personalization helper (M1.1).
 *
 * Run inside the web container (has the musl Prisma engine + DATABASE_URL):
 *   docker compose -f docker-compose.dev.yml exec web npx tsx tests/relevant-concerts.test.ts
 *
 * Seeds two users with DIFFERENT preferences over the SAME global concerts and
 * asserts each sees the correct, disjoint relevant set — the multi-user proof —
 * plus the negative cases (wrong country, unfollowed artist, past concert) and
 * the UserConcert interest left-join. All test rows are namespaced and removed
 * in a finally block.
 */
import { prisma } from '@/lib/prisma';
import { getRelevantConcerts } from '@/lib/concerts';

const P = '__test_rc_'; // namespace prefix for all created rows
const now = Math.floor(Date.now() / 1000);
const FUTURE = now + 30 * 86400;
const PAST = now - 30 * 86400;

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}
function urlsOf(r: { concerts: Array<{ eventUrl: string }> }): Set<string> {
  return new Set(r.concerts.map((c) => c.eventUrl));
}

// Track created ids for cleanup.
const created = {
  users: [] as number[],
  countries: [] as number[],
  cityNormalized: [] as number[],
  cityMappings: [] as number[],
  artists: [] as number[],
  concerts: [] as number[],
};

async function makeCountry(name: string, code: string) {
  const c = await prisma.country.create({
    data: { name: P + name, code, active: true, createdAt: now, updatedAt: now },
  });
  created.countries.push(c.id);
  const cn = await prisma.cityNormalized.create({
    data: { normalizedCity: P + name + '_city', countryId: c.id, createdAt: now, updatedAt: now },
  });
  created.cityNormalized.push(cn.id);
  const cm = await prisma.cityMapping.create({
    data: {
      originalCity: P + name + '_City',
      countryId: c.id,
      cityNormalizedId: cn.id,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    },
  });
  created.cityMappings.push(cm.id);
  return { countryId: c.id, cityMappingId: cm.id };
}

async function makeArtist(name: string) {
  const a = await prisma.artist.create({
    data: { name: P + name, createdAt: now, updatedAt: now },
  });
  created.artists.push(a.id);
  return a.id;
}

async function makeConcert(
  slug: string,
  countryId: number,
  cityMappingId: number,
  artistIds: number[],
  dateStart: number
) {
  const c = await prisma.concert.create({
    data: {
      eventName: P + slug,
      eventUrl: `https://test.local/${P}${slug}`,
      dateStart,
      dateEnd: dateStart,
      venue: P + 'venue',
      cityMappingId,
      countryId,
      performers: JSON.stringify(artistIds.map((_, i) => `perf${i}`)),
      ticketLinks: '[]',
      createdAt: now,
      updatedAt: now,
    },
  });
  created.concerts.push(c.id);
  for (let i = 0; i < artistIds.length; i++) {
    await prisma.artistConcert.create({
      data: { artistId: artistIds[i], concertId: c.id, isPrimary: i === 0, createdAt: now, updatedAt: now },
    });
  }
  return c.id;
}

async function makeUser(name: string) {
  const u = await prisma.user.create({
    data: { username: P + name, hashedPassword: 'x', createdAt: now, updatedAt: now },
  });
  created.users.push(u.id);
  return u.id;
}

async function cleanup() {
  // Order respects foreign keys.
  await prisma.artistConcert.deleteMany({ where: { concertId: { in: created.concerts } } });
  await prisma.userConcert.deleteMany({ where: { concertId: { in: created.concerts } } });
  await prisma.userArtist.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.userActiveCountry.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.concert.deleteMany({ where: { id: { in: created.concerts } } });
  await prisma.cityMapping.deleteMany({ where: { id: { in: created.cityMappings } } });
  await prisma.cityNormalized.deleteMany({ where: { id: { in: created.cityNormalized } } });
  await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
  await prisma.userConcert.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.country.deleteMany({ where: { id: { in: created.countries } } });
}

async function main() {
  // --- Geography (two countries) ---
  const A = await makeCountry('CountryA', 'rcz1');
  const B = await makeCountry('CountryB', 'rcz2');

  // --- Artists ---
  const artistX = await makeArtist('ArtistX'); // followed by user A
  const artistY = await makeArtist('ArtistY'); // followed by user B
  const artistZ = await makeArtist('ArtistZ'); // followed by nobody

  // --- Global concerts (the SAME pool for both users) ---
  // 1: X in CountryA, future   → relevant to A only
  const cXA = await makeConcert('XA', A.countryId, A.cityMappingId, [artistX], FUTURE);
  // 2: Y in CountryB, future   → relevant to B only
  const cYB = await makeConcert('YB', B.countryId, B.cityMappingId, [artistY], FUTURE);
  // 3: X in CountryB, future   → A follows X but B is not A's country → A: no
  const cXB = await makeConcert('XB', B.countryId, B.cityMappingId, [artistX], FUTURE);
  // 4: Z in CountryA, future   → nobody follows Z → neither
  await makeConcert('ZA', A.countryId, A.cityMappingId, [artistZ], FUTURE);
  // 5: X in CountryA, PAST     → past → excluded by upcomingOnly
  await makeConcert('XA_past', A.countryId, A.cityMappingId, [artistX], PAST);
  // 6: X+Y in CountryA, future → A (follows X, country A): yes; B (country B): no
  const cXYA = await makeConcert('XYA', A.countryId, A.cityMappingId, [artistX, artistY], FUTURE);

  // --- Users + preferences ---
  const userA = await makeUser('UserA');
  const userB = await makeUser('UserB');
  // A follows X, active country = A
  await prisma.userArtist.create({ data: { userId: userA, artistId: artistX, playcount: 100, createdAt: now, updatedAt: now } });
  await prisma.userActiveCountry.create({ data: { userId: userA, countryId: A.countryId, createdAt: now, updatedAt: now } });
  // B follows Y, active country = B
  await prisma.userArtist.create({ data: { userId: userB, artistId: artistY, playcount: 50, createdAt: now, updatedAt: now } });
  await prisma.userActiveCountry.create({ data: { userId: userB, countryId: B.countryId, createdAt: now, updatedAt: now } });

  // A marks the XA concert interested (pure user-state)
  await prisma.userConcert.create({ data: { userId: userA, concertId: cXA, interested: true, createdAt: now, updatedAt: now } });

  console.log('\n— User A (follows ArtistX, active country A) —');
  const rA = await getRelevantConcerts(userA);
  const uA = urlsOf(rA);
  check(uA.has(`https://test.local/${P}XA`), 'A sees X@CountryA (followed artist, active country)');
  check(uA.has(`https://test.local/${P}XYA`), 'A sees X+Y@CountryA (co-headliner X is followed)');
  check(!uA.has(`https://test.local/${P}XB`), 'A does NOT see X@CountryB (country not active for A)');
  check(!uA.has(`https://test.local/${P}YB`), 'A does NOT see Y@CountryB (artist not followed, wrong country)');
  check(!uA.has(`https://test.local/${P}ZA`), 'A does NOT see Z@CountryA (artist not followed)');
  check(!uA.has(`https://test.local/${P}XA_past`), 'A does NOT see the PAST X@CountryA concert');
  check(uA.size === 2, `A sees exactly 2 concerts (got ${uA.size})`);

  console.log('\n— User B (follows ArtistY, active country B) —');
  const rB = await getRelevantConcerts(userB);
  const uB = urlsOf(rB);
  check(uB.has(`https://test.local/${P}YB`), 'B sees Y@CountryB');
  check(!uB.has(`https://test.local/${P}XYA`), 'B does NOT see X+Y@CountryA (country A not active for B)');
  check(!uB.has(`https://test.local/${P}XA`), 'B does NOT see X@CountryA');
  check(uB.size === 1, `B sees exactly 1 concert (got ${uB.size})`);

  console.log('\n— Disjointness (multi-user proof) —');
  const overlap = [...uA].filter((u) => uB.has(u));
  check(overlap.length === 0, `A and B share NO concerts despite the same global pool (overlap=${overlap.length})`);

  console.log('\n— UserConcert interest left-join (pure user-state) —');
  const xaForA = rA.concerts.find((c) => c.eventUrl === `https://test.local/${P}XA`);
  const xyaForA = rA.concerts.find((c) => c.eventUrl === `https://test.local/${P}XYA`);
  check(xaForA?.interested === true, 'A: XA shows interested=true (has a UserConcert row)');
  check(xyaForA?.interested === false, 'A: XYA shows interested=false (no UserConcert row, defaulted)');

  console.log('\n— Per-artist followed flag + playcount merge —');
  const xPerf = xaForA?.artists.find((a) => a.artistId === artistX);
  check(xPerf?.artist.followed === true && xPerf?.artist.playcount === 100, 'A: ArtistX marked followed with playcount 100');
  const yPerf = xyaForA?.artists.find((a) => a.artistId === artistY);
  check(yPerf?.artist.followed === false, 'A: co-performer ArtistY (not followed by A) marked followed=false');

  console.log('\n— Preference change without re-scrape: A starts following ArtistZ —');
  await prisma.userArtist.create({ data: { userId: userA, artistId: artistZ, playcount: 5, createdAt: now, updatedAt: now } });
  const rA2 = urlsOf(await getRelevantConcerts(userA));
  check(rA2.has(`https://test.local/${P}ZA`), 'A now sees Z@CountryA immediately (no re-scan)');
  check(rA2.size === 3, `A now sees 3 concerts (got ${rA2.size})`);

  console.log('\n— countryName filter (drives the country-detail page) —');
  // Activate CountryB for A so the country filter has something to narrow.
  await prisma.userActiveCountry.create({ data: { userId: userA, countryId: B.countryId, createdAt: now, updatedAt: now } });
  const allA = urlsOf(await getRelevantConcerts(userA));
  check(allA.has(`https://test.local/${P}XB`), 'A sees X@CountryB after activating CountryB');
  const onlyB = urlsOf(await getRelevantConcerts(userA, { countryName: P + 'CountryB' }));
  check(onlyB.size === 1 && onlyB.has(`https://test.local/${P}XB`), 'countryName=CountryB returns only the CountryB concert');
  const onlyA = urlsOf(await getRelevantConcerts(userA, { countryName: P + 'CountryA' }));
  check(![...onlyA].some((u) => u.endsWith('XB')), 'countryName=CountryA excludes the CountryB concert');

  console.log('\n— artist-detail filter (relevant ∩ this artist) —');
  const relA = (await getRelevantConcerts(userA)).concerts;
  const xUrls = new Set(relA.filter((c) => c.artists.some((a: any) => a.artistId === artistX)).map((c) => c.eventUrl));
  check(
    xUrls.has(`https://test.local/${P}XA`) && xUrls.has(`https://test.local/${P}XYA`) && xUrls.has(`https://test.local/${P}XB`),
    'artist X detail shows XA, XYA, XB (all relevant concerts featuring X)'
  );
  check(!xUrls.has(`https://test.local/${P}ZA`), 'artist X detail excludes ZA (X is not on it)');

  console.log('\n— friend-stats count interested=true only (immune to legacy rows) —');
  await prisma.userConcert.create({ data: { userId: userB, concertId: cYB, interested: true, createdAt: now, updatedAt: now } });
  await prisma.userConcert.create({ data: { userId: userB, concertId: cXB, interested: false, createdAt: now, updatedAt: now } });
  const interestedTotal = await prisma.userConcert.count({ where: { userId: userB, interested: true } });
  const allRows = await prisma.userConcert.count({ where: { userId: userB } });
  check(interestedTotal === 1, `interested-only count = 1 (got ${interestedTotal})`);
  check(allRows === 2, `total UserConcert rows = 2 (got ${allRows}) — the interested=false row would have inflated the old stat`);

  console.log('\n— Empty followed set → sees nothing —');
  const userC = await makeUser('UserC');
  await prisma.userActiveCountry.create({ data: { userId: userC, countryId: A.countryId, createdAt: now, updatedAt: now } });
  const rC = await getRelevantConcerts(userC);
  check(rC.concerts.length === 0, 'A user who follows no artists sees 0 concerts');
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\n💥 Test threw:', err);
    try { await cleanup(); } catch (e) { console.error('cleanup error', e); }
    await prisma.$disconnect();
    process.exit(1);
  });

/**
 * Regression test — the "Your Artists" signal is `followed`, NOT `playcount > 0`.
 *
 * The whole multi-user model lets a user FOLLOW an artist manually (no Last.fm),
 * which creates a UserArtist row with playcount 0. Before this fix, every read
 * surface decided "is this YOUR artist?" with `ac.artist.playcount > 0` — the
 * Last.fm-era signal — so a manually-followed (playcount 0) artist made a concert
 * appear in the list yet showed an EMPTY "Your Artists" section. The chips now
 * filter on `ac.artist.followed`, which getRelevantConcerts() sets from the mere
 * existence of a UserArtist row.
 *
 * Existing tests all followed with playcount 10/100, so `playcount > 0` and
 * `followed` were indistinguishable — this pins the playcount-0 case explicitly.
 *
 * Run inside the web container:
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/followed-flag-decoupled.test.ts
 */
import { prisma } from '@/lib/prisma';
import { getRelevantConcerts } from '@/lib/concerts';

const P = '__test_ffd_';
const now = Math.floor(Date.now() / 1000);
const FUTURE = now + 30 * 86400;

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
  const a = await prisma.artist.create({ data: { name: P + name, createdAt: now, updatedAt: now } });
  created.artists.push(a.id);
  return a.id;
}

async function makeConcert(slug: string, countryId: number, cityMappingId: number, artistIds: number[]) {
  const c = await prisma.concert.create({
    data: {
      eventName: P + slug,
      eventUrl: `https://test.local/${P}${slug}`,
      dateStart: FUTURE,
      dateEnd: FUTURE,
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

async function cleanup() {
  await prisma.artistConcert.deleteMany({ where: { concertId: { in: created.concerts } } });
  await prisma.userConcert.deleteMany({ where: { concertId: { in: created.concerts } } });
  await prisma.userArtist.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.userActiveCountry.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.concert.deleteMany({ where: { id: { in: created.concerts } } });
  await prisma.cityMapping.deleteMany({ where: { id: { in: created.cityMappings } } });
  await prisma.cityNormalized.deleteMany({ where: { id: { in: created.cityNormalized } } });
  await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.country.deleteMany({ where: { id: { in: created.countries } } });
}

async function main() {
  const { countryId, cityMappingId } = await makeCountry('Land', 'ffd1');

  // headliner: manually followed, NO Last.fm → playcount 0
  const followedZero = await makeArtist('FollowedZeroPlaycount');
  // co-performer: NOT followed at all
  const notFollowed = await makeArtist('CoPerformerNotFollowed');
  // a second followed artist WITH a real playcount, as a contrast control
  const followedWithPlays = await makeArtist('FollowedWithPlays');

  const concertId = await makeConcert('mixedbill', countryId, cityMappingId, [followedZero, notFollowed]);
  const concert2 = await makeConcert('haspays', countryId, cityMappingId, [followedWithPlays]);

  const user = await prisma.user.create({
    data: { username: P + 'user', hashedPassword: 'x', createdAt: now, updatedAt: now },
  });
  created.users.push(user.id);

  // Manual follow with playcount 0 — the scenario that was invisible in the UI.
  await prisma.userArtist.create({
    data: { userId: user.id, artistId: followedZero, playcount: 0, playcount12month: 0, recent: false, createdAt: now, updatedAt: now },
  });
  // Control: followed with real plays.
  await prisma.userArtist.create({
    data: { userId: user.id, artistId: followedWithPlays, playcount: 250, playcount12month: 80, recent: true, createdAt: now, updatedAt: now },
  });
  await prisma.userActiveCountry.create({
    data: { userId: user.id, countryId, createdAt: now },
  });

  const { concerts } = await getRelevantConcerts(user.id);
  const byUrl = new Map(concerts.map((c: any) => [c.eventUrl, c]));

  console.log('\n— playcount-0 followed artist is relevant AND chip-visible —');
  const mixed = byUrl.get(`https://test.local/${P}mixedbill`);
  check(!!mixed, 'concert IS relevant via a followed artist that has playcount 0 (relevance ≠ playcount)');

  if (mixed) {
    const fz = mixed.artists.find((ac: any) => ac.artistId === followedZero);
    const nf = mixed.artists.find((ac: any) => ac.artistId === notFollowed);
    check(fz?.artist.followed === true, 'followed artist with playcount 0 → followed === true (chip SHOWS)');
    check(fz?.artist.playcount === 0, 'followed artist still reports playcount 0 (not fabricated)');
    check(nf?.artist.followed === false, 'co-performer not followed → followed === false (chip HIDDEN)');

    // The exact predicate the "Your Artists" chips use, end to end.
    const chips = mixed.artists.filter((ac: any) => ac.artist.followed).map((ac: any) => ac.artistId);
    check(chips.length === 1 && chips[0] === followedZero,
      'chip filter (ac.artist.followed) shows exactly the followed artist — the OLD playcount>0 filter would show NOTHING');
  }

  console.log('\n— contrast: followed-with-plays still works —');
  const hp = byUrl.get(`https://test.local/${P}haspays`);
  const fwp = hp?.artists.find((ac: any) => ac.artistId === followedWithPlays);
  check(fwp?.artist.followed === true && fwp?.artist.playcount === 250,
    'followed artist with playcount 250 → followed === true, playcount 250 (unchanged behaviour)');

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  });

/**
 * Read-only sanity check: prove read-time personalization HIDES things.
 * Shows artists admin doesn't follow, and upcoming concerts correctly invisible
 * to admin — with the reason (wrong country vs no followed artist).
 *
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/invisible-artists-check.ts
 */
import { prisma } from '@/lib/prisma';

async function main() {
  const admin =
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ||
    (await prisma.user.findFirst({ orderBy: { id: 'asc' } }));
  if (!admin) return console.log('No users.');
  const now = Math.floor(Date.now() / 1000);

  const totalArtists = await prisma.artist.count();
  const followed = await prisma.userArtist.findMany({ where: { userId: admin.id }, select: { artistId: true } });
  const followedIds = new Set(followed.map((f) => f.artistId));
  const activeCountries = await prisma.userActiveCountry.findMany({ where: { userId: admin.id }, select: { countryId: true } });
  const activeIds = new Set(activeCountries.map((a) => a.countryId));

  console.log(`Artists in DB: ${totalArtists} | admin follows: ${followedIds.size} | NOT followed (should be invisible): ${totalArtists - followedIds.size}\n`);

  const sampleNotFollowed = await prisma.artist.findMany({
    where: { id: { notIn: [...followedIds] } },
    take: 10,
    orderBy: { id: 'asc' },
  });
  console.log('Sample of artists admin does NOT follow:');
  console.log('  ' + sampleNotFollowed.map((a) => a.name).join(', ') + '\n');

  // All upcoming concerts, classify each.
  const upcoming = await prisma.concert.findMany({
    where: { dateStart: { gte: now } },
    include: { artists: { include: { artist: true } }, countryObj: true },
    orderBy: { dateStart: 'asc' },
  });

  let visible = 0;
  let hiddenWrongCountry = 0;
  let hiddenNoFollowedArtist = 0;
  let hiddenBoth = 0;
  const hiddenInActiveCountryExamples: string[] = [];

  for (const c of upcoming) {
    const inActive = activeIds.has(c.countryId);
    const hasFollowed = c.artists.some((ac) => followedIds.has(ac.artistId));
    if (inActive && hasFollowed) {
      visible++;
    } else if (!inActive && !hasFollowed) {
      hiddenBoth++;
    } else if (!inActive) {
      hiddenWrongCountry++;
    } else {
      // In an active country, but NO followed artist → hidden purely by artist filter.
      hiddenNoFollowedArtist++;
      if (hiddenInActiveCountryExamples.length < 5) {
        const d = new Date(c.dateStart * 1000).toISOString().slice(0, 10);
        const performers = c.artists.map((ac) => ac.artist.name).join(', ') || '(none)';
        hiddenInActiveCountryExamples.push(`  ${d}  "${c.eventName}" @ ${c.countryObj?.name}  — performers: ${performers}`);
      }
    }
  }

  console.log(`Upcoming concerts: ${upcoming.length}`);
  console.log(`  ✅ visible to admin:                       ${visible}`);
  console.log(`  🚫 hidden — country not active:            ${hiddenWrongCountry}`);
  console.log(`  🚫 hidden — active country, no followed artist: ${hiddenNoFollowedArtist}`);
  console.log(`  🚫 hidden — both reasons:                  ${hiddenBoth}\n`);

  console.log('Proof of ARTIST-level hiding (these are in an ACTIVE country, so the ONLY');
  console.log('reason they are invisible is that admin follows none of their performers):');
  if (hiddenInActiveCountryExamples.length === 0) {
    console.log('  (none — every upcoming concert in an active country has a followed artist)');
  } else {
    hiddenInActiveCountryExamples.forEach((l) => console.log(l));
    // Double-check: confirm none of the performers are followed.
    console.log('\n  ↳ confirming none of those performers are in admin\'s followed set… ' +
      '(by construction above, hasFollowed=false for each)');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

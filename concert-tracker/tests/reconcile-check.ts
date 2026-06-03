/** One consistent snapshot: reconcile getRelevantConcerts() vs inline classification. */
import { prisma } from '@/lib/prisma';
import { getRelevantConcerts } from '@/lib/concerts';

async function main() {
  const admin = (await prisma.user.findFirst({ where: { role: 'ADMIN' } }))!;
  const now = Math.floor(Date.now() / 1000);

  const active = await prisma.userActiveCountry.findMany({ where: { userId: admin.id }, include: { country: true } });
  const activeIds = new Set(active.map((a) => a.countryId));
  console.log(`admin id=${admin.id}`);
  console.log(`active countries: ${active.map((a) => `${a.country.name}(id=${a.countryId})`).join(', ')}`);

  const followed = await prisma.userArtist.findMany({ where: { userId: admin.id }, select: { artistId: true } });
  const followedIds = new Set(followed.map((f) => f.artistId));
  console.log(`followed artists: ${followedIds.size}`);

  // Helper result
  const { concerts } = await getRelevantConcerts(admin.id);
  const byC = new Map<string, number>();
  for (const c of concerts) byC.set(c.countryObj?.name || '?', (byC.get(c.countryObj?.name || '?') || 0) + 1);
  console.log(`\nHELPER getRelevantConcerts(): ${concerts.length}  [${[...byC].map(([k, v]) => `${k}:${v}`).join(', ')}]`);

  // Inline classification over upcoming
  const upcoming = await prisma.concert.findMany({
    where: { dateStart: { gte: now } },
    include: { artists: true, countryObj: true },
  });
  let vis = 0;
  const visByCountry = new Map<string, number>();
  for (const c of upcoming) {
    const inActive = activeIds.has(c.countryId);
    const hasFollowed = c.artists.some((ac) => followedIds.has(ac.artistId));
    if (inActive && hasFollowed) {
      vis++;
      visByCountry.set(c.countryObj?.name || '?', (visByCountry.get(c.countryObj?.name || '?') || 0) + 1);
    }
  }
  console.log(`INLINE visible:               ${vis}  [${[...visByCountry].map(([k, v]) => `${k}:${v}`).join(', ')}]`);
  console.log(`\nMATCH: ${concerts.length === vis ? 'YES ✅ (helper == inline)' : 'NO ❌ — logic discrepancy!'}`);

  // What France concerts (upcoming) look like
  const france = await prisma.country.findFirst({ where: { name: 'France' } });
  if (france) {
    const frUpcoming = upcoming.filter((c) => c.countryId === france.id);
    const frWithFollowed = frUpcoming.filter((c) => c.artists.some((ac) => followedIds.has(ac.artistId)));
    console.log(`\nFrance id=${france.id}  inActiveSet=${activeIds.has(france.id)}  upcoming=${frUpcoming.length}  withFollowedArtist=${frWithFollowed.length}`);
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

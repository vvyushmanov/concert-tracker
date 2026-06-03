/**
 * Real-data smoke check (not a pass/fail test): prints what the personalized
 * pages WILL show for the real admin user, and the delta vs the OLD
 * UserConcert-based approach, so we know what to expect during manual browser
 * verification.
 *
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/page-data-smoke.ts
 */
import { prisma } from '@/lib/prisma';
import { getRelevantConcerts } from '@/lib/concerts';

async function main() {
  const admin =
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ||
    (await prisma.user.findFirst({ orderBy: { id: 'asc' } }));
  if (!admin) {
    console.log('No users in DB.');
    return;
  }
  console.log(`User: ${admin.username} (id=${admin.id}, role=${admin.role})\n`);

  const followed = await prisma.userArtist.count({ where: { userId: admin.id } });
  const active = await prisma.userActiveCountry.findMany({
    where: { userId: admin.id },
    include: { country: true },
  });
  const totalGlobalConcerts = await prisma.concert.count();
  const now = Math.floor(Date.now() / 1000);
  const upcomingGlobal = await prisma.concert.count({ where: { dateStart: { gte: now } } });

  console.log(`Followed artists (UserArtist):     ${followed}`);
  console.log(`Active countries (UserActiveCountry): ${active.length} [${active.map((a) => a.country.name).join(', ')}]`);
  console.log(`Global concerts in DB:             ${totalGlobalConcerts} (upcoming: ${upcomingGlobal})\n`);

  // NEW read-time personalization (what the pages show now)
  const { concerts } = await getRelevantConcerts(admin.id);
  console.log(`▶ NEW (read-time relevant, upcoming): ${concerts.length} concerts`);

  const byCountry = new Map<string, number>();
  for (const c of concerts) {
    const n = c.countryObj?.name || 'Unknown';
    byCountry.set(n, (byCountry.get(n) || 0) + 1);
  }
  for (const [k, v] of [...byCountry.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${v}`);
  }
  const interestedCount = concerts.filter((c) => c.interested).length;
  console.log(`    (of which marked interested: ${interestedCount})`);
  console.log('    sample:');
  for (const c of concerts.slice(0, 5)) {
    const d = new Date(c.dateStart * 1000).toISOString().slice(0, 10);
    const primary = c.artist?.name || '?';
    console.log(`      ${d}  ${primary}  @ ${c.venue}, ${c.countryObj?.name}  interested=${c.interested}`);
  }

  // OLD approach for comparison (UserConcert-materialized, no date filter)
  const oldCount = await prisma.userConcert.count({ where: { userId: admin.id } });
  console.log(`\n▶ OLD (materialized UserConcert rows, any date): ${oldCount}`);
  console.log(
    `\nNote: NEW counts upcoming concerts whose followed artist plays in an active country;\n` +
      `OLD counted every materialized match (incl. past). Differences are expected and correct.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

/**
 * Integration test for lib/userArtists (follow / unfollow / search).
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/user-artists.test.ts
 */
import { prisma } from '@/lib/prisma';
import { followArtist, unfollowArtist, searchArtists } from '@/lib/userArtists';

const P = '__test_ua_';
const now = Math.floor(Date.now() / 1000);
let passed = 0;
let failed = 0;
const check = (c: boolean, m: string) => {
  c ? passed++ : failed++;
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

const created = { users: [] as number[], artists: [] as number[] };

async function main() {
  const user = await prisma.user.create({ data: { username: P + 'user', hashedPassword: 'x', createdAt: now, updatedAt: now } });
  created.users.push(user.id);
  const userId = user.id;

  // Pre-existing artist to follow by id
  const known = await prisma.artist.create({ data: { name: P + 'KnownBand', createdAt: now, updatedAt: now } });
  created.artists.push(known.id);

  console.log('— followArtist —');
  const r1 = await followArtist(userId, { name: P + 'NewBand' });
  check(r1.ok, 'follow by name (new) succeeds & creates the Artist');
  check(r1.ok && r1.created === true, 'follow by name (new) reports created=true (triggers metadata enrich)');
  if (r1.ok) created.artists.push(r1.artist.id);
  const created1 = await prisma.userArtist.count({ where: { userId } });
  check(created1 === 1, `1 UserArtist row after first follow (got ${created1})`);

  const r1again = await followArtist(userId, { name: P + 'NewBand' });
  check(r1again.ok, 'follow same name again is idempotent (no error)');
  check(r1again.ok && r1again.created === false, 'following an existing-name artist reports created=false');
  const created2 = await prisma.userArtist.count({ where: { userId } });
  check(created2 === 1, `still 1 UserArtist row (idempotent, got ${created2})`);

  const r2 = await followArtist(userId, { artistId: known.id });
  check(r2.ok, 'follow by artistId succeeds');
  check(r2.ok && r2.created === false, 'follow by artistId reports created=false');
  check((await prisma.userArtist.count({ where: { userId } })) === 2, 'now 2 followed');

  const rNone = await followArtist(userId, {});
  check(!rNone.ok && rNone.status === 400, 'follow with neither id nor name → 400');
  const rMissing = await followArtist(userId, { artistId: 999999999 });
  check(!rMissing.ok && rMissing.status === 404, 'follow non-existent artistId → 404');

  console.log('— searchArtists —');
  check((await searchArtists(userId, 'a')).length === 0, 'query < 2 chars returns []');
  const found = await searchArtists(userId, P + 'known'); // lowercase → case-insensitive contains
  check(found.some((a) => a.id === known.id && a.following === true), 'search finds KnownBand case-insensitively, following=true');
  const foundNew = await searchArtists(userId, P + 'New');
  check(foundNew.some((a) => a.following === true), 'NewBand shows following=true');

  console.log('— unfollowArtist —');
  await unfollowArtist(userId, known.id);
  check((await prisma.userArtist.count({ where: { userId } })) === 1, 'unfollow removes the row');
  const afterUnfollow = await searchArtists(userId, P + 'known');
  check(afterUnfollow.some((a) => a.id === known.id && a.following === false), 'KnownBand now shows following=false');
  await unfollowArtist(userId, known.id); // idempotent
  check((await prisma.userArtist.count({ where: { userId } })) === 1, 'unfollow again is idempotent');
}

main()
  .then(async () => {
    await prisma.userArtist.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
    console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    try {
      await prisma.userArtist.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.artist.deleteMany({ where: { id: { in: created.artists } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    } catch {}
    await prisma.$disconnect();
    process.exit(1);
  });

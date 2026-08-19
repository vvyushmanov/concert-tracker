import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { getRelevantConcerts } from '@/lib/concerts';
import ArtistsList from './ArtistsList';
import ArtistManager from './ArtistManager';

export const dynamic = 'force-dynamic';

export default async function ArtistsPage() {
  const session = await auth();
  
  // Require authentication
  if (!session) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
        <main className="max-w-7xl mx-auto">
          <div className="text-center py-16">
            <h1 className="text-3xl font-bold mb-4">Please Log In</h1>
            <p className="text-gray-600 dark:text-gray-400">
              You need to be logged in to view your artists.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const userId = parseInt(session.user.id);

  // Personalized read: relevant (upcoming) concerts for this user, then group by
  // the user's FOLLOWED artists that appear on them (see lib/concerts.ts).
  const { concerts, followedArtistIds } = await getRelevantConcerts(userId);
  const followedSet = new Set(followedArtistIds);

  const artistMap = new Map<number, { artist: any; concerts: any[] }>();
  for (const concert of concerts) {
    for (const ac of concert.artists) {
      if (!followedSet.has(ac.artistId)) continue;
      if (!artistMap.has(ac.artistId)) {
        artistMap.set(ac.artistId, { artist: ac.artist, concerts: [] });
      }
      artistMap.get(ac.artistId)!.concerts.push(concert);
    }
  }

  // Per-artist stats (helper already restricted to upcoming + relevant concerts).
  const artistsWithStats = Array.from(artistMap.values())
    .map((data) => {
      const uniqueCountries = new Set(
        data.concerts.map((c: any) => c.countryObj?.name || 'Unknown')
      );
      return {
        id: data.artist.id,
        name: data.artist.name,
        imageUrl: data.artist.imageUrl,
        playcount: data.artist.playcount || 0,
        playcount12month: data.artist.playcount12month || 0,
        recent: data.artist.recent || false,
        upcomingConcertCount: data.concerts.length,
        countryCount: uniqueCountries.size,
        countries: Array.from(uniqueCountries) as string[],
      };
    })
    .filter((artist) => artist.upcomingConcertCount > 0)
    .sort((a, b) => b.playcount - a.playcount); // Sort by playcount descending

  // Full followed list with stats (incl. artists with no upcoming concerts) so
  // the grid can toggle between "with concerts" and "all followed".
  const upcomingStatsMap = new Map(artistsWithStats.map((a) => [a.id, a]));
  const followedRows = await prisma.userArtist.findMany({
    where: { userId },
    include: { artist: { select: { id: true, name: true, imageUrl: true } } },
    orderBy: { playcount: 'desc' },
  });
  const allFollowed = followedRows.map((r) => {
    const up = upcomingStatsMap.get(r.artist.id);
    return {
      id: r.artist.id,
      name: r.artist.name,
      imageUrl: r.artist.imageUrl,
      playcount: r.playcount,
      playcount12month: r.playcount12month,
      recent: r.recent,
      upcomingConcertCount: up?.upcomingConcertCount ?? 0,
      countryCount: up?.countryCount ?? 0,
      countries: up?.countries ?? [],
    };
  });

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Artists</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {artistsWithStats.length} with upcoming concerts · {allFollowed.length} followed
          </p>
        </div>

        <ArtistManager followedCount={allFollowed.length} />

        {allFollowed.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-2">You&apos;re not following any artists yet</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Sync from Last.fm or search to follow artists above, then pick your countries in Settings. 🎵
            </p>
          </div>
        ) : (
          <ArtistsList artists={allFollowed} />
        )}
      </main>
    </div>
  );
}

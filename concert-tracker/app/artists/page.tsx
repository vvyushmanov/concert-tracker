import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import ArtistsList from './ArtistsList';

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
  const now = Math.floor(Date.now() / 1000);

  // Get only concerts linked to this user via UserConcert
  const userConcerts = await prisma.userConcert.findMany({
    where: { userId },
    include: {
      concert: {
        include: {
          artist: true,
          countryObj: true,
        }
      }
    }
  });

  // Extract concerts with artist data
  const concerts = userConcerts.map(uc => uc.concert);

  // Group concerts by artist
  const artistMap = new Map();
  concerts.forEach(concert => {
    if (!artistMap.has(concert.artistId)) {
      artistMap.set(concert.artistId, {
        artist: concert.artist,
        concerts: []
      });
    }
    artistMap.get(concert.artistId).concerts.push(concert);
  });

  // Get user-specific artist stats from UserArtist table
  const userArtistStats = await prisma.userArtist.findMany({
    where: { 
      userId,
      artistId: { in: Array.from(artistMap.keys()) }
    }
  });

  const userArtistStatsMap = new Map(
    userArtistStats.map(ua => [ua.artistId, ua])
  );

  // Calculate stats with upcoming concerts only
  const artistsWithStats = Array.from(artistMap.entries()).map(([artistId, data]) => {
    const upcomingConcerts = data.concerts.filter((c: any) => c.dateStart >= now);
    const uniqueCountries = new Set(upcomingConcerts.map((c: any) => c.countryObj?.name || 'Unknown'));
    const userStats = userArtistStatsMap.get(artistId);
    
    return {
      id: data.artist.id,
      name: data.artist.name,
      imageUrl: data.artist.imageUrl,
      playcount: userStats?.playcount || 0,
      playcount12month: userStats?.playcount12month || 0,
      recent: userStats?.recent || false,
      upcomingConcertCount: upcomingConcerts.length,
      countryCount: uniqueCountries.size,
      countries: Array.from(uniqueCountries) as string[],
    };
  }).filter(artist => artist.upcomingConcertCount > 0) // Only show artists with upcoming concerts
    .sort((a, b) => b.playcount - a.playcount); // Sort by playcount descending

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Artists</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {artistsWithStats.length} artists with upcoming concerts
          </p>
        </div>

        {artistsWithStats.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-2xl font-semibold mb-4">No artists found</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Please run the scanner to discover concerts! 🎵
            </p>
            <a
              href="/scanner"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Go to Scanner
            </a>
          </div>
        ) : (
          <ArtistsList artists={artistsWithStats} />
        )}
      </main>
    </div>
  );
}

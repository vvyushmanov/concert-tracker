import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import ConcertGrid from './ConcertGrid';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth();
  
  // Require authentication
  if (!session) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
        <main className="max-w-7xl mx-auto">
          <div className="text-center py-16">
            <h1 className="text-3xl font-bold mb-4">Please Log In</h1>
            <p className="text-gray-600 dark:text-gray-400">
              You need to be logged in to view your concerts.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const userId = parseInt(session.user.id);

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
    },
    orderBy: {
      concert: {
        dateStart: 'asc'
      }
    }
  });

  // Get user-specific artist stats for all artists in these concerts
  const artistIds = Array.from(new Set(userConcerts.map(uc => uc.concert.artistId)));
  const userArtistStats = await prisma.userArtist.findMany({
    where: {
      userId,
      artistId: { in: artistIds }
    }
  });

  // Create a map for quick lookup
  const artistStatsMap = new Map(
    userArtistStats.map(ua => [ua.artistId, ua])
  );

  // Extract concerts with user data and artist playcount
  const concertsWithUserData = userConcerts.map(uc => ({
    ...uc.concert,
    interested: uc.interested,
    notes: uc.notes,
    artist: {
      ...uc.concert.artist,
      playcount: artistStatsMap.get(uc.concert.artistId)?.playcount12month || 0,
    }
  }));

  // Count unique artists from user's concerts
  const uniqueArtistIds = new Set(concertsWithUserData.map(c => c.artistId));
  
  const stats = {
    total: concertsWithUserData.length,
    artists: uniqueArtistIds.size,
  };

  // Get unique artists from user's concerts for filters
  const uniqueArtists = Array.from(uniqueArtistIds).map(id => {
    const concert = concertsWithUserData.find(c => c.artistId === id);
    return concert?.artist;
  }).filter(Boolean);

  // Get unique countries from user's concerts for filters
  const uniqueCountryNames = Array.from(
    new Set(concertsWithUserData.map(c => c.countryObj?.name).filter(Boolean))
  ) as string[];

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">All Concerts</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {stats.total} concerts from {stats.artists} artists
          </p>
        </div>

        {concertsWithUserData.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-2xl font-semibold mb-4">No concerts added yet</h2>
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
          <ConcertGrid
            initialConcerts={concertsWithUserData}
            artists={uniqueArtists}
            countries={uniqueCountryNames}
          />
        )}
      </main>
    </div>
  );
}

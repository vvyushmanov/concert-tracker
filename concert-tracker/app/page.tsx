import { auth } from '@/auth';
import { getRelevantConcerts } from '@/lib/concerts';
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

  // Personalized read: global concerts filtered by the user's followed artists
  // and active countries (see lib/concerts.ts). Reflects preference changes
  // instantly — no re-scan required.
  const { concerts: concertsWithUserData } = await getRelevantConcerts(userId);

  // Unique primary artists (for the filter dropdown)
  const uniqueArtistIds = new Set(
    concertsWithUserData.map((c) => c.artistId).filter(Boolean) as number[]
  );
  const uniqueArtists = Array.from(uniqueArtistIds)
    .map((id) => concertsWithUserData.find((c) => c.artistId === id)?.artist)
    .filter(Boolean);

  // Get unique countries from user's concerts for filters
  const uniqueCountryNames = Array.from(
    new Set(concertsWithUserData.map((c) => c.countryObj?.name).filter(Boolean))
  ) as string[];

  const stats = {
    total: concertsWithUserData.length,
    artists: uniqueArtistIds.size,
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <main className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">All Concerts</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {stats.total} concerts from {stats.artists} artists
          </p>
        </div>

        {concertsWithUserData.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-2xl font-semibold mb-4">No matching concerts yet</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Follow some artists (or sync your Last.fm) and pick your countries to see relevant concerts. 🎵
            </p>
            <a
              href="/artists"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Manage Artists
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

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import CalendarView from './CalendarView';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await auth();
  
  // Require authentication
  if (!session) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
        <main className="max-w-7xl mx-auto">
          <div className="text-center py-16">
            <h1 className="text-3xl font-bold mb-4">Please Log In</h1>
            <p className="text-gray-600 dark:text-gray-400">
              You need to be logged in to view your concert calendar.
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

  // Extract concerts with user data
  const concertsWithUserData = userConcerts.map(uc => ({
    ...uc.concert,
    interested: uc.interested,
    notes: uc.notes,
  }));

  // Get unique artists from user's concerts
  const uniqueArtistIds = new Set(concertsWithUserData.map(c => c.artistId));
  const uniqueArtists = Array.from(uniqueArtistIds).map(id => {
    const concert = concertsWithUserData.find(c => c.artistId === id);
    return concert?.artist;
  }).filter(Boolean);

  // Get unique countries from user's concerts
  const uniqueCountryNames = Array.from(
    new Set(concertsWithUserData.map(c => c.countryObj?.name).filter(Boolean))
  ) as string[];

  // Get unique cities from user's concerts
  const cities = Array.from(
    new Map(
      concertsWithUserData.map(c => [
        `${c.normalizedCity}-${c.countryObj?.name}`,
        { city: c.normalizedCity, country: c.countryObj?.name || 'Unknown' }
      ])
    ).values()
  ) as { city: string; country: string }[];

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Concert Calendar</h1>
          <p className="text-gray-600 dark:text-gray-400">
            View concerts by date with filters
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
          <CalendarView
            initialConcerts={concertsWithUserData}
            artists={uniqueArtists}
            countries={uniqueCountryNames}
            cities={cities}
          />
        )}
      </main>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import ConcertGrid from './ConcertGrid';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const stats = {
    total: await prisma.concert.count(),
    artists: await prisma.artist.count(),
  };

  // Query with all fields including dates (now Unix timestamps)
  // Note: 'interested' is now per-user in UserConcert table (Phase 4)
  const concerts = await prisma.concert.findMany({
    orderBy: [
      { dateStart: 'asc' },
    ],
    include: {
      artist: true,
      countryObj: true, // Include country relation
    },
  });

  // Get unique artists and countries for filters
  const artists = await prisma.artist.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // Get countries from Country table
  const countries = await prisma.country.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true },
  });

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">All Concerts</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {stats.total} concerts from {stats.artists} artists
          </p>
        </div>

        <ConcertGrid
          initialConcerts={concerts}
          artists={artists}
          countries={countries.map(c => c.name)}
        />
      </main>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import CalendarView from './CalendarView';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  // Get all concerts
  const concerts = await prisma.concert.findMany({
    include: {
      artist: true,
      countryObj: true, // Include country relation
    },
    orderBy: {
      dateStart: 'asc',
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

  const cities = await prisma.concert.findMany({
    select: { 
      normalizedCity: true, 
      countryObj: {
        select: { name: true }
      }
    },
    distinct: ['normalizedCity', 'countryId'],
    orderBy: { normalizedCity: 'asc' },
  });

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Concert Calendar</h1>
          <p className="text-gray-600 dark:text-gray-400">
            View concerts by date with filters
          </p>
        </div>

        <CalendarView
          initialConcerts={concerts.map(c => ({
            ...c,
            artist: c.artist,
          }))}
          artists={artists}
          countries={countries.map(c => c.name)}
          cities={cities.map(c => ({ city: c.normalizedCity, country: c.countryObj?.name || 'Unknown' }))}
        />
      </main>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CountryConcerts from './CountryConcerts';

export const dynamic = 'force-dynamic';

export default async function CountryDetailPage({ params }: { params: Promise<{ country: string }> }) {
  const { country: countryParam } = await params;
  const country = decodeURIComponent(countryParam);

  const concerts = await prisma.concert.findMany({
    where: { country },
    include: {
      artist: {
        select: {
          id: true,
          name: true,
          playcount: true,
        },
      },
    },
    orderBy: [
      { interested: 'desc' }, // Pinned concerts first
      { dateStart: 'asc' },
    ],
  });

  if (concerts.length === 0) {
    notFound();
  }

  // Get unique normalized cities and artists
  const cities = [...new Set(concerts.map(c => c.normalizedCity))];
  const artists = new Set(concerts.map(c => c.artist.name)).size;

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        {/* Back button */}
        <Link 
          href="/countries"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-6"
        >
          ← Back to Countries
        </Link>

        {/* Country header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 mb-6">
          <h1 className="text-4xl font-bold mb-4 flex items-center gap-3">
            <span>🌍</span>
            <span>{country}</span>
          </h1>
          
          <div className="flex flex-wrap gap-6 text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎤</span>
              <span>{concerts.length} {concerts.length === 1 ? 'concert' : 'concerts'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📍</span>
              <span>{cities.length} {cities.length === 1 ? 'city' : 'cities'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎸</span>
              <span>{artists} artists</span>
            </div>
          </div>
        </div>

        {/* Concerts */}
        <CountryConcerts concerts={concerts} />
      </main>
    </div>
  );
}

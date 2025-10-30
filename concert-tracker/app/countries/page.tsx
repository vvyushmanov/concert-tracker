import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function CountriesPage() {
  // Get all concerts grouped by country
  const concerts = await prisma.concert.findMany({
    select: {
      country: true,
      city: true,
      id: true,
      artist: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      dateStart: 'asc',
    },
  });

  // Group concerts by country
  const concertsByCountry = concerts.reduce((acc, concert) => {
    if (!acc[concert.country]) {
      acc[concert.country] = {
        count: 0,
        cities: new Set<string>(),
        artists: new Set<string>(),
      };
    }
    acc[concert.country].count++;
    acc[concert.country].cities.add(concert.city);
    acc[concert.country].artists.add(concert.artist.name);
    return acc;
  }, {} as Record<string, { count: number; cities: Set<string>; artists: Set<string> }>);

  // Convert to array and sort by concert count
  const countriesData = Object.entries(concertsByCountry)
    .map(([country, data]) => ({
      country,
      concertCount: data.count,
      cityCount: data.cities.size,
      artistCount: data.artists.size,
      cities: Array.from(data.cities).slice(0, 5),
    }))
    .sort((a, b) => b.concertCount - a.concertCount);

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Countries</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Concerts across {countriesData.length} {countriesData.length === 1 ? 'country' : 'countries'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {countriesData.map((countryData) => (
            <Link
              key={countryData.country}
              href={`/countries/${encodeURIComponent(countryData.country)}`}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <span>🌍</span>
                <span>{countryData.country}</span>
              </h2>
              
              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎤</span>
                  <span>
                    <strong className="text-gray-900 dark:text-white">
                      {countryData.concertCount}
                    </strong>{' '}
                    {countryData.concertCount === 1 ? 'concert' : 'concerts'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-base">🎸</span>
                  <span>
                    <strong className="text-gray-900 dark:text-white">
                      {countryData.artistCount}
                    </strong>{' '}
                    {countryData.artistCount === 1 ? 'artist' : 'artists'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-base">📍</span>
                  <span>
                    <strong className="text-gray-900 dark:text-white">
                      {countryData.cityCount}
                    </strong>{' '}
                    {countryData.cityCount === 1 ? 'city' : 'cities'}
                  </span>
                </div>
              </div>

              {countryData.cities.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Top cities:</p>
                  <div className="flex flex-wrap gap-2">
                    {countryData.cities.map((city) => (
                      <span
                        key={city}
                        className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded"
                      >
                        {city}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

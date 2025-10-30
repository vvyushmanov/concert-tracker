import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-dynamic';

export default async function ArtistsPage() {
  // Get all artists with concert counts
  const artists = await prisma.artist.findMany({
    include: {
      _count: {
        select: { concerts: true }
      },
      concerts: {
        select: {
          country: true,
        }
      }
    },
    orderBy: {
      playcount: 'desc',
    },
  });

  // Calculate unique countries per artist
  const artistsWithStats = artists.map(artist => {
    const uniqueCountries = new Set(artist.concerts.map(c => c.country));
    return {
      ...artist,
      concertCount: artist._count.concerts,
      countryCount: uniqueCountries.size,
      countries: Array.from(uniqueCountries),
    };
  });

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Artists</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {artists.length} artists with upcoming concerts
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {artistsWithStats.map((artist) => (
            <Link
              key={artist.id}
              href={`/artists/${artist.id}`}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
            >
              {artist.imageUrl && (
                <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 relative">
                  <Image
                    src={artist.imageUrl}
                    alt={artist.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                </div>
              )}
              
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-xl font-bold flex-1">
                    {artist.name}
                  </h2>
                  {artist.recent && (
                    <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-1 rounded-full">
                      Recent
                    </span>
                  )}
                </div>
              
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎸</span>
                  <span>{artist.playcount.toLocaleString()} plays on Last.fm</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base">🎤</span>
                  <span>{artist.concertCount} {artist.concertCount === 1 ? 'concert' : 'concerts'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base">🌍</span>
                  <span>{artist.countryCount} {artist.countryCount === 1 ? 'country' : 'countries'}</span>
                </div>
              </div>

                {artist.countries.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex flex-wrap gap-2">
                      {artist.countries.slice(0, 5).map((country) => (
                        <span
                          key={country}
                          className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded"
                        >
                          {country}
                        </span>
                      ))}
                      {artist.countries.length > 5 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          +{artist.countries.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

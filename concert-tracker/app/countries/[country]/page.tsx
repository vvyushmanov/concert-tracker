import { prisma } from '@/lib/prisma';
import { format } from 'date-fns';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CountryDetailPage({ params }: { params: Promise<{ country: string }> }) {
  const { country: countryParam } = await params;
  const country = decodeURIComponent(countryParam);

  const concerts = await prisma.concert.findMany({
    where: { country },
    include: {
      artist: true,
    },
    orderBy: [
      { interested: 'desc' }, // Pinned concerts first
      { dateStart: 'asc' },
    ],
  });

  if (concerts.length === 0) {
    notFound();
  }

  // Group concerts by city
  const concertsByCity = concerts.reduce((acc, concert) => {
    if (!acc[concert.city]) {
      acc[concert.city] = [];
    }
    acc[concert.city].push(concert);
    return acc;
  }, {} as Record<string, typeof concerts>);

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
              <span>{Object.keys(concertsByCity).length} {Object.keys(concertsByCity).length === 1 ? 'city' : 'cities'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎸</span>
              <span>{new Set(concerts.map(c => c.artist.name)).size} artists</span>
            </div>
          </div>
        </div>

        {/* Concerts grouped by city */}
        <div className="space-y-8">
          {Object.entries(concertsByCity).map(([city, cityConcerts]) => (
            <div key={city}>
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <span>📍</span>
                <span>{city}</span>
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({cityConcerts.length} {cityConcerts.length === 1 ? 'concert' : 'concerts'})
                </span>
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cityConcerts.map((concert) => {
                  const startDate = new Date(concert.dateStart * 1000);
                  const endDate = new Date(concert.dateEnd * 1000);
                  const isSameDay = concert.dateStart === concert.dateEnd;
                  
                  return (
                    <Link
                      key={concert.id}
                      href={`/concerts/${concert.id}`}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow block relative"
                    >
                      {concert.interested && (
                        <div className="absolute top-2 right-2 z-10 bg-yellow-400 text-yellow-900 px-2 py-1 rounded-full text-xs font-bold">
                          ⭐ Pinned
                        </div>
                      )}
                      {concert.imageUrl && (
                        <Image 
                          src={concert.imageUrl} 
                          alt={concert.eventName}
                          width={400}
                          height={160}
                          className="w-full h-40 object-cover"
                        />
                      )}
                      <div className="p-4">
                        <div className="mb-2">
                          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                            {concert.artist.name}
                          </span>
                        </div>
                        <h3 className="font-bold mb-2 line-clamp-2">
                          {concert.eventName}
                        </h3>
                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                          <p className="flex items-start gap-2">
                            <span>📅</span>
                            <span>
                              {format(startDate, 'MMM dd, yyyy')}
                              {!isSameDay && ` - ${format(endDate, 'MMM dd, yyyy')}`}
                            </span>
                          </p>
                          <p className="flex items-start gap-2">
                            <span>📍</span>
                            <span>{concert.venue}</span>
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

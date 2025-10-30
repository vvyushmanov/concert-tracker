import { prisma } from '@/lib/prisma';
import { format } from 'date-fns';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function ArtistDetailPage({ params }: { params: { id: string } }) {
  const artistId = parseInt(params.id);
  
  if (isNaN(artistId)) {
    notFound();
  }

  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      concerts: {
        orderBy: {
          dateStart: 'asc',
        },
      },
    },
  });

  if (!artist) {
    notFound();
  }

  // Group concerts by country
  const concertsByCountry = artist.concerts.reduce((acc, concert) => {
    if (!acc[concert.country]) {
      acc[concert.country] = [];
    }
    acc[concert.country].push(concert);
    return acc;
  }, {} as Record<string, typeof artist.concerts>);

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        {/* Back button */}
        <Link 
          href="/artists"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-6"
        >
          ← Back to Artists
        </Link>

        {/* Artist header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 mb-6">
          <div className="flex items-start justify-between mb-4">
            <h1 className="text-4xl font-bold">{artist.name}</h1>
            {artist.recent && (
              <span className="text-sm bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-3 py-1 rounded-full">
                Recently Played
              </span>
            )}
          </div>
          
          <div className="flex flex-wrap gap-6 text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎸</span>
              <span>{artist.playcount.toLocaleString()} plays on Last.fm</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎤</span>
              <span>{artist.concerts.length} {artist.concerts.length === 1 ? 'concert' : 'concerts'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🌍</span>
              <span>{Object.keys(concertsByCountry).length} {Object.keys(concertsByCountry).length === 1 ? 'country' : 'countries'}</span>
            </div>
          </div>
        </div>

        {/* Concerts grouped by country */}
        <div className="space-y-8">
          {Object.entries(concertsByCountry).map(([country, concerts]) => (
            <div key={country}>
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <span>🌍</span>
                <span>{country}</span>
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({concerts.length} {concerts.length === 1 ? 'concert' : 'concerts'})
                </span>
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {concerts.map((concert) => {
                  const startDate = new Date(concert.dateStart * 1000);
                  const endDate = new Date(concert.dateEnd * 1000);
                  const isSameDay = concert.dateStart === concert.dateEnd;
                  
                  return (
                    <div
                      key={concert.id}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                    >
                      {concert.imageUrl && (
                        <img 
                          src={concert.imageUrl} 
                          alt={concert.eventName}
                          className="w-full h-40 object-cover"
                        />
                      )}
                      <div className="p-4">
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
                            <span>{concert.venue}, {concert.city}</span>
                          </p>
                          <a 
                            href={concert.eventUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 font-medium mt-2"
                          >
                            View Event →
                          </a>
                        </div>
                      </div>
                    </div>
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

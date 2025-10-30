import { prisma } from '@/lib/prisma';
import { format } from 'date-fns';
import Image from 'next/image';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const stats = {
    total: await prisma.concert.count(),
    artists: await prisma.artist.count(),
  };

  // Query with all fields including dates (now Unix timestamps)
  const concerts = await prisma.concert.findMany({
    orderBy: {
      dateStart: 'asc',
    },
    include: {
      artist: true,
    },
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {concerts.map((concert) => {
            // Convert Unix timestamps to Date objects
            const startDate = new Date(concert.dateStart * 1000);
            const endDate = new Date(concert.dateEnd * 1000);
            const isSameDay = concert.dateStart === concert.dateEnd;
            
            return (
              <div
                key={concert.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                {concert.imageUrl && (
                  <div className="w-full h-48 relative">
                    <Image
                      src={concert.imageUrl} 
                      alt={concert.eventName}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                  </div>
                )}
                <div className="p-6">
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                      {concert.artist.name}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold mb-3 line-clamp-2">
                    {concert.eventName}
                  </h2>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                    <p className="flex items-start gap-2">
                      <span className="text-base">📅</span>
                      <span>
                        {format(startDate, 'MMM dd, yyyy')}
                        {!isSameDay && ` - ${format(endDate, 'MMM dd, yyyy')}`}
                      </span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="text-base">📍</span>
                      <span>{concert.venue}, {concert.city}, {concert.country}</span>
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
      </main>
    </div>
  );
}

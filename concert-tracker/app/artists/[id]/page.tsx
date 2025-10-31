import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArtistConcerts from './ArtistConcerts';

export const dynamic = 'force-dynamic';

export default async function ArtistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artistId = parseInt(id);
  
  if (isNaN(artistId)) {
    notFound();
  }

  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      concerts: {
        orderBy: [
          { interested: 'desc' }, // Pinned concerts first
          { dateStart: 'asc' },
        ],
      },
    },
  });

  if (!artist) {
    notFound();
  }

  // Get unique countries
  const countries = [...new Set(artist.concerts.map(c => c.country))];

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
              <span>{countries.length} {countries.length === 1 ? 'country' : 'countries'}</span>
            </div>
          </div>
        </div>

        {/* Concerts */}
        <ArtistConcerts concerts={artist.concerts} />
      </main>
    </div>
  );
}

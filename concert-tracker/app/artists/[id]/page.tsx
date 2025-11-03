import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import Image from 'next/image';
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
        include: {
          countryObj: true,
        },
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
  const countries = [...new Set(artist.concerts.map(c => c.countryObj?.name || 'Unknown'))];

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
          <div className="flex gap-6">
            {/* Artist Image */}
            {artist.imageUrl && (
              <div className="flex-shrink-0">
                <div className="w-48 h-48 relative rounded-lg overflow-hidden">
                  <Image
                    src={artist.imageUrl}
                    alt={artist.name}
                    fill
                    className="object-cover"
                    sizes="192px"
                  />
                </div>
              </div>
            )}
            
            {/* Artist Info */}
            <div className="flex-1">
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
                  <span className="text-xl">🎧</span>
                  <span>{artist.playcount12month.toLocaleString()} plays (12 months)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔊</span>
                  <span>{artist.playcount.toLocaleString()} all-time plays</span>
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
              
              {/* Last.fm Link */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <a
                  href={`https://www.last.fm/music/${encodeURIComponent(artist.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Image
                    src="https://cdn.last.fm/favicon.ico"
                    alt="Last.fm"
                    width={16}
                    height={16}
                    className="flex-shrink-0"
                  />
                  <span>View on Last.fm</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Concerts */}
        <ArtistConcerts concerts={artist.concerts} />
      </main>
    </div>
  );
}

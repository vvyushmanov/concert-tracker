import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import ArtistConcerts from './ArtistConcerts';

export const dynamic = 'force-dynamic';

export default async function ArtistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const artistId = parseInt(id);
  
  if (isNaN(artistId)) {
    notFound();
  }

  // Require authentication
  if (!session) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
        <main className="max-w-7xl mx-auto">
          <div className="text-center py-16">
            <h1 className="text-3xl font-bold mb-4">Please Log In</h1>
            <p className="text-gray-600 dark:text-gray-400">
              You need to be logged in to view artist details.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const userId = parseInt(session.user.id);

  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
  });

  if (!artist) {
    notFound();
  }

  // Get user's concerts where this artist performs (via ArtistConcert junction)
  const artistConcerts = await prisma.artistConcert.findMany({
    where: { artistId },
    include: {
      concert: {
        include: {
          countryObj: true,
          userInteractions: {
            where: { userId },
            select: { interested: true, notes: true }
          }
        }
      }
    },
    orderBy: {
      concert: {
        dateStart: 'asc'
      }
    }
  });

  // Filter to only concerts the user has (via UserConcert)
  const userConcertIds = new Set(
    (await prisma.userConcert.findMany({
      where: { userId },
      select: { concertId: true }
    })).map(uc => uc.concertId)
  );

  const userConcerts = artistConcerts.filter(ac => 
    userConcertIds.has(ac.concertId)
  );

  const concerts = userConcerts.map((ac: any) => ({
    ...ac.concert,
    interested: ac.concert.userInteractions[0]?.interested || false,
    notes: ac.concert.userInteractions[0]?.notes || '',
  }));

  // Get user-specific artist stats
  const userArtistStats = await prisma.userArtist.findUnique({
    where: {
      userId_artistId: { userId, artistId }
    }
  });

  // Get unique countries
  const countries = [...new Set(concerts.map(c => c.countryObj?.name || 'Unknown'))];

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
                {userArtistStats?.recent && (
                  <span className="text-sm bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-3 py-1 rounded-full">
                    Recently Played
                  </span>
                )}
              </div>
              
              <div className="flex flex-wrap gap-6 text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎧</span>
                  <span>{(userArtistStats?.playcount12month || 0).toLocaleString()} plays (12 months)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔊</span>
                  <span>{(userArtistStats?.playcount || 0).toLocaleString()} all-time plays</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎤</span>
                  <span>{concerts.length} {concerts.length === 1 ? 'concert' : 'concerts'}</span>
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
        <ArtistConcerts concerts={concerts} />
      </main>
    </div>
  );
}

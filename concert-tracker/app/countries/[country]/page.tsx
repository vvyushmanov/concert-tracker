import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CountryConcerts from './CountryConcerts';

export const dynamic = 'force-dynamic';

export default async function CountryDetailPage({ params }: { params: Promise<{ country: string }> }) {
  const { country: countryParam } = await params;
  const country = decodeURIComponent(countryParam);
  
  const session = await auth();
  const userId = session?.user?.id ? parseInt(session.user.id) : null;

  const concerts = await prisma.concert.findMany({
    where: {
      countryObj: {
        name: country
      }
    },
    include: {
      artist: {
        select: {
          id: true,
          name: true,
          userStats: userId ? {
            where: {
              userId: userId
            },
            select: {
              playcount: true,
              playcount12month: true,
              recent: true,
            }
          } : false,
        },
      },
      userInteractions: userId ? {
        where: {
          userId: userId
        },
        select: {
          interested: true,
          notes: true,
        }
      } : false,
    },
    orderBy: [
      { dateStart: 'asc' },
    ],
  });

  if (concerts.length === 0) {
    notFound();
  }

  // Transform data to flatten user-specific fields
  const transformedConcerts = concerts.map(concert => ({
    ...concert,
    artist: {
      id: concert.artist.id,
      name: concert.artist.name,
      playcount: concert.artist.userStats?.[0]?.playcount || 0,
      playcount12month: concert.artist.userStats?.[0]?.playcount12month || 0,
      recent: concert.artist.userStats?.[0]?.recent || false,
    },
    interested: concert.userInteractions?.[0]?.interested || false,
    notes: concert.userInteractions?.[0]?.notes || null,
  }));

  // Get unique normalized cities and artists
  const cities = [...new Set(transformedConcerts.map(c => c.normalizedCity))];
  const artists = new Set(transformedConcerts.map(c => c.artist.name)).size;

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
        <CountryConcerts concerts={transformedConcerts} />
      </main>
    </div>
  );
}

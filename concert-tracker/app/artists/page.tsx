import { prisma } from '@/lib/prisma';
import ArtistsList from './ArtistsList';

export const dynamic = 'force-dynamic';

export default async function ArtistsPage() {
  const now = Math.floor(Date.now() / 1000);

  // Get all artists with concerts
  const artists = await prisma.artist.findMany({
    include: {
      concerts: {
        select: {
          country: true,
          dateStart: true,
        }
      }
    },
    orderBy: {
      playcount: 'desc',
    },
  });

  // Calculate stats with upcoming concerts only
  const artistsWithStats = artists.map(artist => {
    const upcomingConcerts = artist.concerts.filter(c => c.dateStart >= now);
    const uniqueCountries = new Set(upcomingConcerts.map(c => c.country));
    
    return {
      id: artist.id,
      name: artist.name,
      imageUrl: artist.imageUrl,
      playcount: artist.playcount,
      recent: artist.recent,
      upcomingConcertCount: upcomingConcerts.length,
      countryCount: uniqueCountries.size,
      countries: Array.from(uniqueCountries),
    };
  }).filter(artist => artist.upcomingConcertCount > 0); // Only show artists with upcoming concerts

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Artists</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {artistsWithStats.length} artists with upcoming concerts
          </p>
        </div>

        <ArtistsList artists={artistsWithStats} />
      </main>
    </div>
  );
}

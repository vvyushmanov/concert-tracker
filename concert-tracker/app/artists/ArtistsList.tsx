'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

type Artist = {
  id: number;
  name: string;
  imageUrl: string | null;
  playcount: number;
  playcount12month: number;
  recent: boolean;
  upcomingConcertCount: number;
  countryCount: number;
  countries: string[];
};

type ArtistsListProps = {
  artists: Artist[];
};

export default function ArtistsList({ artists }: ArtistsListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'playcount' | 'playcount12month' | 'concerts'>('playcount12month');
  const [showAll, setShowAll] = useState(false); // false = only artists with upcoming concerts
  const [unfollowingId, setUnfollowingId] = useState<number | null>(null);
  const router = useRouter();

  const withConcertsCount = useMemo(() => artists.filter((a) => a.upcomingConcertCount > 0).length, [artists]);

  const handleUnfollow = async (e: React.MouseEvent, artistId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setUnfollowingId(artistId);
    try {
      await fetch(`/api/user-artists?artistId=${artistId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setUnfollowingId(null);
    }
  };

  // Filter and sort artists
  const filteredArtists = useMemo(() => {
    const filtered = artists.filter((artist) => {
      if (!showAll && artist.upcomingConcertCount === 0) return false;
      if (searchQuery) return artist.name.toLowerCase().includes(searchQuery.toLowerCase());
      return true;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'playcount':
          return b.playcount - a.playcount;
        case 'playcount12month':
          return b.playcount12month - a.playcount12month;
        case 'concerts':
          return b.upcomingConcertCount - a.upcomingConcertCount;
        default:
          return 0;
      }
    });
    return filtered;
  }, [artists, searchQuery, sortBy, showAll]);

  return (
    <div className="space-y-6">
      {/* Search and Sort Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Search Artists</label>
            <input
              type="text"
              placeholder="Search by artist name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="playcount12month">12-Month Plays</option>
              <option value="playcount">All-Time Plays</option>
              <option value="concerts">Upcoming Concerts</option>
              <option value="name">Artist Name</option>
            </select>
          </div>
        </div>

        {/* Show-all toggle */}
        <div className="mt-4 inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
          <button
            onClick={() => setShowAll(false)}
            className={`px-4 py-2 transition-colors ${!showAll ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            With concerts ({withConcertsCount})
          </button>
          <button
            onClick={() => setShowAll(true)}
            className={`px-4 py-2 transition-colors ${showAll ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            All followed ({artists.length})
          </button>
        </div>

        {/* Stats Row */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredArtists.length}</span> of{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">{showAll ? artists.length : withConcertsCount}</span> artists
          </div>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              Clear search
            </button>
          )}
        </div>
      </div>

      {/* Artists Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredArtists.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
            {!showAll && withConcertsCount === 0 && artists.length > 0 ? (
              <>None of your followed artists have upcoming concerts. Switch to <button onClick={() => setShowAll(true)} className="text-blue-600 dark:text-blue-400 hover:underline">All followed</button> to manage them.</>
            ) : (
              'No artists found matching your search.'
            )}
          </div>
        ) : (
          filteredArtists.map((artist) => (
            <Link
              key={artist.id}
              href={`/artists/${artist.id}`}
              className="relative bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
            >
              {/* Unfollow button */}
              <button
                onClick={(e) => handleUnfollow(e, artist.id)}
                disabled={unfollowingId === artist.id}
                title="Unfollow this artist"
                className="absolute top-2 right-2 z-10 px-3 py-1 rounded-full text-xs font-medium bg-white/95 dark:bg-gray-900/90 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 shadow-sm hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors disabled:opacity-50"
              >
                {unfollowingId === artist.id ? '…' : '✕ Unfollow'}
              </button>

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
                  <h2 className="text-xl font-bold flex-1 pr-6">{artist.name}</h2>
                  {artist.recent && (
                    <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-1 rounded-full">Recent</span>
                  )}
                </div>

                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🎧</span>
                    <span>{artist.playcount12month.toLocaleString()} plays (12 months)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">🔊</span>
                    <span>{artist.playcount.toLocaleString()} all-time plays</span>
                  </div>
                  {artist.upcomingConcertCount > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-base">🎤</span>
                        <span>{artist.upcomingConcertCount} upcoming {artist.upcomingConcertCount === 1 ? 'concert' : 'concerts'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-base">🌍</span>
                        <span>{artist.countryCount} {artist.countryCount === 1 ? 'country' : 'countries'}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                      <span className="text-base">🎤</span>
                      <span>No upcoming concerts in your countries</span>
                    </div>
                  )}
                </div>

                {artist.countries.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex flex-wrap gap-2">
                      {artist.countries.slice(0, 5).map((country) => (
                        <span key={country} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded">
                          {country}
                        </span>
                      ))}
                      {artist.countries.length > 5 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">+{artist.countries.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

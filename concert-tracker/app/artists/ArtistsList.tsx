'use client';

import { useState, useMemo, useEffect } from 'react';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();

  // Poll for refresh status
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const response = await fetch('/api/metadata/status');
        const data = await response.json();
        
        if (data.isRefreshing !== isRefreshing) {
          setIsRefreshing(data.isRefreshing);
          
          // If refresh just completed, reload the page data
          if (!data.isRefreshing && isRefreshing) {
            router.refresh();
          }
        }
      } catch (error) {
        console.error('Error checking refresh status:', error);
      }
    };

    if (isRefreshing) {
      interval = setInterval(checkStatus, 2000); // Poll every 2 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRefreshing, router]);

  const handleRefreshMetadata = async () => {
    try {
      setIsRefreshing(true);
      const response = await fetch('/api/metadata/refresh', {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to start metadata refresh:', error);
        setIsRefreshing(false);
      }
    } catch (error) {
      console.error('Error starting metadata refresh:', error);
      setIsRefreshing(false);
    }
  };

  // Filter and sort artists
  const filteredArtists = useMemo(() => {
    let filtered = artists.filter(artist => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return artist.name.toLowerCase().includes(query);
      }
      return true;
    });

    // Sort
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
  }, [artists, searchQuery, sortBy]);

  return (
    <div className="space-y-6">
      {/* Search and Sort Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Search Bar */}
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

          {/* Sort */}
          <div>
            <label className="block text-sm font-medium mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="playcount">All-Time Plays</option>
              <option value="playcount12month">12-Month Plays</option>
              <option value="concerts">Upcoming Concerts</option>
              <option value="name">Artist Name</option>
            </select>
          </div>
        </div>

        {/* Stats Row */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredArtists.length}</span> of <span className="font-semibold text-gray-900 dark:text-gray-100">{artists.length}</span> artists
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefreshMetadata}
              disabled={isRefreshing}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isRefreshing
                  ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isRefreshing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Refreshing...
                </span>
              ) : (
                '🔄 Refresh Metadata'
              )}
            </button>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Artists Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredArtists.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
            No artists found matching your search.
          </div>
        ) : (
          filteredArtists.map((artist) => (
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
                    <span className="text-base">🎧</span>
                    <span>{artist.playcount12month.toLocaleString()} plays (12 months)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">🔊</span>
                    <span>{artist.playcount.toLocaleString()} all-time plays</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">🎤</span>
                    <span>{artist.upcomingConcertCount} upcoming {artist.upcomingConcertCount === 1 ? 'concert' : 'concerts'}</span>
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
          ))
        )}
      </div>
    </div>
  );
}

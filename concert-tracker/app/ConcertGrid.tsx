'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import Image from 'next/image';
import Link from 'next/link';

type Concert = {
  id: number;
  eventName: string;
  imageUrl: string | null;
  dateStart: number;
  dateEnd: number;
  venue: string;
  cityMapping: {
    id: number;
    originalCity: string;
    latitude: string | null;
    longitude: string | null;
    cityNormalized: {
      normalizedCity: string;
      country: {
        id: number;
        name: string;
        code: string;
      };
    };
  };
  countryObj?: {
    id: number;
    name: string;
    code: string;
  } | null;
  interested: boolean;
  artistId: number;
  artist: {
    id: number;
    name: string;
    playcount: number;
  };
  artists?: {
    id: number;
    artistId: number;
    isPrimary: boolean;
    artist: {
      id: number;
      name: string;
      playcount: number;
    };
  }[];
};

type ConcertGridProps = {
  initialConcerts: Concert[];
  artists: { id: number; name: string }[];
  countries: string[];
};

export default function ConcertGrid({ initialConcerts, artists, countries }: ConcertGridProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<number | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showInterestedOnly, setShowInterestedOnly] = useState(false);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'artist' | 'playcount' | 'recent' | 'multiartist'>('date');

  const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp

  // Filter and sort concerts
  const { upcomingConcerts, pastConcerts } = useMemo(() => {
    let filtered = initialConcerts.filter(concert => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          concert.eventName.toLowerCase().includes(query) ||
          concert.artist.name.toLowerCase().includes(query) ||
          concert.venue.toLowerCase().includes(query) ||
          concert.cityMapping.originalCity.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Artist filter - check if artist performs at this concert (any role)
      if (selectedArtist && concert.artists && !concert.artists.some((ac: any) => ac.artistId === selectedArtist)) return false;

      // Country filter
      if (selectedCountry && concert.countryObj?.name !== selectedCountry) return false;

      // Interested filter
      if (showInterestedOnly && !concert.interested) return false;

      return true;
    });

    // Split into upcoming and past
    const upcoming = filtered.filter(c => c.dateStart >= now);
    const past = filtered.filter(c => c.dateStart < now);

    // Sort function
    const sortConcerts = (concerts: Concert[]) => {
      return concerts.sort((a, b) => {
        // Interested concerts always first
        if (a.interested && !b.interested) return -1;
        if (!a.interested && b.interested) return 1;

        switch (sortBy) {
          case 'date':
            return a.dateStart - b.dateStart;
          case 'artist':
            return a.artist.name.localeCompare(b.artist.name);
          case 'playcount':
            // Sort by playcount (which is actually playcount12month from server)
            return b.artist.playcount - a.artist.playcount;
          case 'recent':
            return b.id - a.id;
          case 'multiartist':
            // Sort by number of artists (more artists = higher)
            const aCount = a.artists?.length || 0;
            const bCount = b.artists?.length || 0;
            if (bCount !== aCount) return bCount - aCount;
            // If same count, sort by date
            return a.dateStart - b.dateStart;
          default:
            return 0;
        }
      });
    };

    return {
      upcomingConcerts: sortConcerts(upcoming),
      pastConcerts: sortConcerts(past),
    };
  }, [initialConcerts, searchQuery, selectedArtist, selectedCountry, showInterestedOnly, sortBy, now]);

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        {/* Search Bar */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search concerts, artists, venues, cities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Filters Row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Artist</label>
            <select
              value={selectedArtist || ''}
              onChange={(e) => setSelectedArtist(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="">All Artists</option>
              {artists.map(artist => (
                <option key={artist.id} value={artist.id}>{artist.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Country</label>
            <select
              value={selectedCountry || ''}
              onChange={(e) => setSelectedCountry(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="">All Countries</option>
              {countries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="date">Date</option>
              <option value="artist">Artist Name</option>
              <option value="playcount">Artist Popularity</option>
              <option value="recent">Recently Added</option>
              <option value="multiartist">Multi-artist First</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInterestedOnly}
                onChange={(e) => setShowInterestedOnly(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Interested Only</span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedArtist(null);
                setSelectedCountry(null);
                setShowInterestedOnly(false);
                setShowPastEvents(false);
                setSortBy('date');
              }}
              className="w-full px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {upcomingConcerts.length} upcoming concert{upcomingConcerts.length !== 1 ? 's' : ''}
          {pastConcerts.length > 0 && ` • ${pastConcerts.length} past concert${pastConcerts.length !== 1 ? 's' : ''}`}
        </div>
        {pastConcerts.length > 0 && (
          <button
            onClick={() => setShowPastEvents(!showPastEvents)}
            className="text-sm px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            {showPastEvents ? 'Hide' : 'Show'} Past Events
          </button>
        )}
      </div>

      {/* Upcoming Concerts Grid */}
      <div>
        <h2 className="text-xl font-bold mb-4">Upcoming Concerts</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {upcomingConcerts.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
              No upcoming concerts found matching your filters.
            </div>
          ) : (
            upcomingConcerts.map((concert) => {
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
                      <span>{concert.venue}, {concert.cityMapping.originalCity}, {concert.countryObj?.name}</span>
                    </p>
                    {concert.artists && concert.artists.length > 0 && (
                      <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">🎸 Your Artists:</p>
                        <div className="flex flex-wrap gap-1">
                          {concert.artists
                            .filter(ac => ac.artist.playcount > 0)
                            .map(ac => (
                              <span
                                key={ac.id}
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  ac.isPrimary
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                                }`}
                              >
                                {ac.artist.name}
                              </span>
                            ))
                          }
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
        </div>
      </div>

      {/* Past Concerts Grid */}
      {showPastEvents && pastConcerts.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 text-gray-500 dark:text-gray-400">Past Concerts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-75">
            {pastConcerts.map((concert) => {
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
                    <div className="w-full h-48 relative grayscale">
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
                        <span>{concert.venue}, {concert.cityMapping.originalCity}, {concert.countryObj?.name}</span>
                      </p>
                      {concert.artists && concert.artists.length > 0 && (
                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">🎸 Your Artists:</p>
                          <div className="flex flex-wrap gap-1">
                            {concert.artists
                              .filter(ac => ac.artist.playcount > 0)
                              .map(ac => (
                                <span
                                  key={ac.id}
                                  className={`text-xs px-2 py-0.5 rounded-full ${
                                    ac.isPrimary
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {ac.artist.name}
                                </span>
                              ))
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import Image from 'next/image';
import Link from 'next/link';
import ConcertDetailSidebar from './components/ConcertDetailSidebar';

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
      followed?: boolean;
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
  const [selectedConcertId, setSelectedConcertId] = useState<number | null>(null);
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);

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
    <div className="flex gap-4 transition-all duration-300 relative">
      {/* Left Sidebar - Filters (collapsible on desktop) */}
      {!isFilterCollapsed && (
        <div className="hidden lg:block w-64 flex-shrink-0">
          <div className="sticky bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 space-y-4" style={{ top: '64px' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold">Filters</h3>
              <button
                onClick={() => setIsFilterCollapsed(true)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
                title="Collapse filters"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            </div>
          
          <div>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1.5">Artist</label>
            <select
              value={selectedArtist || ''}
              onChange={(e) => setSelectedArtist(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="">All Artists</option>
              {artists.map(artist => (
                <option key={artist.id} value={artist.id}>{artist.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1.5">Country</label>
            <select
              value={selectedCountry || ''}
              onChange={(e) => setSelectedCountry(e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="">All Countries</option>
              {countries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1.5">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="date">Date</option>
              <option value="artist">Artist Name</option>
              <option value="playcount">Artist Popularity</option>
              <option value="recent">Recently Added</option>
              <option value="multiartist">Multi-artist First</option>
            </select>
          </div>

          <div>
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

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPastEvents}
                onChange={(e) => setShowPastEvents(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Show Past Events</span>
            </label>
          </div>

          <div>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedArtist(null);
                setSelectedCountry(null);
                setShowInterestedOnly(false);
                setShowPastEvents(false);
                setSortBy('date');
              }}
              className="w-full px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Clear All
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Expand button when filters are collapsed - modern vertical tab design */}
      {isFilterCollapsed && (
        <button
          onClick={() => setIsFilterCollapsed(false)}
          className="hidden lg:flex fixed left-0 flex-col items-center gap-2 bg-white dark:bg-gray-800 rounded-r-lg shadow-lg px-2 py-4 hover:px-3 transition-all duration-200 border-r border-t border-b border-gray-200 dark:border-gray-700 group"
          style={{ top: '80px', zIndex: 50 }}
          title="Show filters"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" style={{ writingMode: 'vertical-rl' }}>
            Filters
          </span>
        </button>
      )}

      {/* Main content area - shifts when sidebar opens */}
      <div className={`flex-1 space-y-6`} style={{
        marginRight: selectedConcertId ? (typeof window !== 'undefined' && window.innerWidth < 768 ? '0' : (typeof window !== 'undefined' && window.innerWidth < 1024 ? '500px' : '600px')) : '0'
      }}>

      {/* Upcoming Concerts Grid */}
      <div>
        <h2 className="text-xl font-bold mb-4">Upcoming Concerts</h2>
        <div className={`grid grid-cols-1 gap-6 ${
          selectedConcertId ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'
        }`}>
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
              <div
                key={concert.id}
                onClick={() => setSelectedConcertId(concert.id)}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative"
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
                            .filter(ac => ac.artist.followed)
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
              </div>
            );
          })
          )}
        </div>
      </div>

      {/* Past Events Section */}
      {showPastEvents && pastConcerts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-gray-500 dark:text-gray-400">Past Events</h2>
          <div className={`grid grid-cols-1 gap-6 ${
            selectedConcertId ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {pastConcerts.map((concert) => {
              const startDate = new Date(concert.dateStart * 1000);
              const endDate = new Date(concert.dateEnd * 1000);
              const isSameDay = concert.dateStart === concert.dateEnd;
              
              return (
                <div
                  key={concert.id}
                  onClick={() => setSelectedConcertId(concert.id)}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative"
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
                              .filter(ac => ac.artist.followed)
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
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      </div>
      
      {/* Concert Detail Sidebar */}
      <ConcertDetailSidebar 
        concertId={selectedConcertId}
        onClose={() => setSelectedConcertId(null)}
      />
    </div>
  );
}

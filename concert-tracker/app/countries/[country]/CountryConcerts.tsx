'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import Image from 'next/image';

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
  interested: boolean;
  notes: string | null;
  artist: {
    id: number;
    name: string;
    playcount: number;
    playcount12month: number;
    recent: boolean;
  };
};

type CountryConcertsProps = {
  concerts: Concert[];
};

export default function CountryConcerts({ concerts }: CountryConcertsProps) {
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<number | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [showInterestedOnly, setShowInterestedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'artist' | 'playcount' | 'recent' | 'multiartist'>('date');
  
  const now = Math.floor(Date.now() / 1000);
  
  // Get unique artists and cities for filters
  const artists = useMemo(() => {
    const artistMap = new Map();
    concerts.forEach(c => {
      if (!artistMap.has(c.artist.id)) {
        artistMap.set(c.artist.id, c.artist);
      }
    });
    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [concerts]);

  const cities = useMemo(() => {
    return [...new Set(concerts
      .map(c => c.cityMapping?.cityNormalized?.normalizedCity)
      .filter((city): city is string => city !== undefined)
    )].sort();
  }, [concerts]);

  // Filter and sort concerts
  const { upcomingConcerts, pastConcerts } = useMemo(() => {
    let filtered = concerts.filter(concert => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          concert.eventName.toLowerCase().includes(query) ||
          concert.artist.name.toLowerCase().includes(query) ||
          concert.venue.toLowerCase().includes(query) ||
          concert.cityMapping?.originalCity?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Artist filter - check if artist performs at this concert (any role)
      if (selectedArtist && concert.artists && !concert.artists.some((ac: any) => ac.artistId === selectedArtist)) return false;

      // City filter
      if (selectedCity && concert.cityMapping?.cityNormalized?.normalizedCity !== selectedCity) return false;

      // Interested filter
      if (showInterestedOnly && !concert.interested) return false;

      return true;
    });

    // Split into upcoming and past
    const upcoming = filtered.filter(c => c.dateStart >= now);
    const past = filtered.filter(c => c.dateStart < now);

    // Sort function
    const sortConcerts = (concertList: Concert[]) => {
      return concertList.sort((a, b) => {
        // Interested concerts always first
        if (a.interested && !b.interested) return -1;
        if (!a.interested && b.interested) return 1;

        switch (sortBy) {
          case 'date':
            return a.dateStart - b.dateStart;
          case 'artist':
            return a.artist.name.localeCompare(b.artist.name);
          case 'playcount':
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
      totalFiltered: showInterestedOnly ? filtered.filter(c => c.interested).length : filtered.length,
    };
  }, [concerts, searchQuery, selectedArtist, selectedCity, showInterestedOnly, sortBy, now]);
  
  // Group by normalized city
  const groupByCity = (concertList: Concert[]) => {
    return concertList.reduce((acc, concert) => {
      const key = concert.cityMapping?.cityNormalized?.normalizedCity || 'Unknown';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(concert);
      return acc;
    }, {} as Record<string, Concert[]>);
  };
  
  const upcomingByCity = groupByCity(upcomingConcerts);
  const pastByCity = groupByCity(pastConcerts);
  
  const renderConcertCard = (concert: Concert, isPast: boolean = false) => {
    const startDate = new Date(concert.dateStart * 1000);
    const endDate = new Date(concert.dateEnd * 1000);
    const isSameDay = concert.dateStart === concert.dateEnd;
    
    return (
      <Link
        key={concert.id}
        href={`/concerts/${concert.id}`}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow block relative"
      >
        {concert.imageUrl && (
          <Image 
            src={concert.imageUrl} 
            alt={concert.eventName}
            width={400}
            height={160}
            className={`w-full h-40 object-cover ${isPast ? 'grayscale' : ''}`}
          />
        )}
        <div className="p-4">
          <div className="mb-2 flex items-center justify-end">
            {concert.interested && (
              <span className="text-yellow-500 text-xl" title="Interested">⭐</span>
            )}
          </div>
          <h3 className="font-bold mb-2 line-clamp-2">
            {concert.eventName}
          </h3>
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <p className="flex items-start gap-2">
              <span>📅</span>
              <span>
                {format(startDate, 'MMM dd, yyyy')}
                {!isSameDay && ` - ${format(endDate, 'MMM dd, yyyy')}`}
              </span>
            </p>
            <p className="flex items-start gap-2">
              <span>📍</span>
              <span>{concert.venue}</span>
            </p>
            {concert.artists && concert.artists.length > 0 && (
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">🎸 Your Artists:</p>
                <div className="flex flex-wrap gap-1">
                  {concert.artists
                    .filter((ac: any) => ac.artist.followed)
                    .map((ac: any) => (
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
  };

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
            <label className="block text-sm font-medium mb-2">City</label>
            <select
              value={selectedCity || ''}
              onChange={(e) => setSelectedCity(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="">All Cities</option>
              {cities.map(city => (
                <option key={city} value={city}>{city}</option>
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
                className="w-4 h-4 rounded"
              />
              <span className="text-sm whitespace-nowrap">⭐ Interested Only</span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedArtist(null);
                setSelectedCity(null);
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

      {/* Results Count and Toggle */}
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

      {/* Upcoming Concerts */}
      {Object.keys(upcomingByCity).length > 0 && (
        <div className="space-y-8">
          <h2 className="text-2xl font-bold">Upcoming Concerts</h2>
          {Object.entries(upcomingByCity).map(([normalizedCity, cityConcerts]) => (
            <div key={normalizedCity}>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span>📍</span>
                <span>{normalizedCity}</span>
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({cityConcerts.length} {cityConcerts.length === 1 ? 'concert' : 'concerts'})
                </span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cityConcerts.map((concert) => renderConcertCard(concert, false))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Past Concerts */}
      {showPastEvents && Object.keys(pastByCity).length > 0 && (
        <div className="space-y-8 opacity-75">
          <h2 className="text-2xl font-bold text-gray-500 dark:text-gray-400">Past Concerts</h2>
          {Object.entries(pastByCity).map(([normalizedCity, cityConcerts]) => (
            <div key={normalizedCity}>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <span>📍</span>
                <span>{normalizedCity}</span>
                <span className="text-sm font-normal">
                  ({cityConcerts.length} {cityConcerts.length === 1 ? 'concert' : 'concerts'})
                </span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cityConcerts.map((concert) => renderConcertCard(concert, true))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No concerts message */}
      {upcomingConcerts.length === 0 && pastConcerts.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No concerts found in this country.
        </div>
      )}
    </div>
  );
}

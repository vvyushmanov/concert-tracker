'use client';

import { useState, useMemo } from 'react';
import { MapConcert } from '@/app/types/map';
import { getUserColor, isConcertShared, SHARED_CONCERT_EMOJI } from '@/app/lib/mapColors';

interface ConcertSidebarProps {
  concerts: MapConcert[];
  currentUserId: number;
  selectedFriendIds: number[];
  selectedConcertIds: number[];
  visibleConcertIds: number[];
  onConcertClick: (concertId: number) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onConcertsUpdate: () => void;
}

export default function ConcertSidebar({
  concerts,
  currentUserId,
  selectedFriendIds,
  selectedConcertIds,
  visibleConcertIds,
  onConcertClick,
  isMinimized,
  onToggleMinimize,
  onConcertsUpdate,
}: ConcertSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Toggle interested status for a concert
  const toggleInterested = async (concertId: number, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/concerts/${concertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interested: !currentStatus }),
      });

      if (response.ok) {
        // Refresh concerts data without full page reload
        onConcertsUpdate();
      }
    } catch (error) {
      console.error('Failed to toggle interested status:', error);
    }
  };

  // Filter and sort concerts
  const filteredConcerts = useMemo(() => {
    let filtered = concerts;

    // Filter by visible concerts in viewport (only if we have viewport data)
    if (visibleConcertIds.length > 0) {
      filtered = filtered.filter(c => visibleConcertIds.includes(c.id));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(concert => 
        concert.eventName.toLowerCase().includes(query) ||
        concert.venue.toLowerCase().includes(query) ||
        concert.city.toLowerCase().includes(query) ||
        concert.country.name.toLowerCase().includes(query) ||
        concert.artists.some(a => a.artist.name.toLowerCase().includes(query))
      );
    }

    // If specific concerts are selected on map, show only those
    if (selectedConcertIds.length > 0) {
      filtered = filtered.filter(c => selectedConcertIds.includes(c.id));
    }

    // Sort: interested concerts first, then by date (earliest first)
    return filtered.sort((a, b) => {
      // Check if concerts have interested user interactions
      const aHasInterested = a.userInteractions.some(ui => ui.interested);
      const bHasInterested = b.userInteractions.some(ui => ui.interested);
      
      // Interested concerts come first
      if (aHasInterested && !bHasInterested) return -1;
      if (!aHasInterested && bHasInterested) return 1;
      
      // If both or neither are interested, sort by date
      return a.dateStart - b.dateStart;
    });
  }, [concerts, searchQuery, selectedConcertIds, visibleConcertIds]);

  // Format date
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Get primary artist name
  const getPrimaryArtist = (concert: MapConcert) => {
    const primary = concert.artists.find(a => a.isPrimary);
    return primary?.artist.name || concert.artists[0]?.artist.name || 'Unknown Artist';
  };

  // Get user color for concert tile
  const getConcertColor = (concert: MapConcert) => {
    // If concert has current user, use their color
    const hasCurrentUser = concert.userInteractions.some(ui => ui.userId === currentUserId);
    if (hasCurrentUser) {
      return getUserColor(currentUserId, currentUserId, selectedFriendIds);
    }
    
    // Otherwise use first friend's color
    const friendInteraction = concert.userInteractions.find(ui => 
      selectedFriendIds.includes(ui.userId)
    );
    if (friendInteraction) {
      return getUserColor(friendInteraction.userId, currentUserId, selectedFriendIds);
    }
    
    // Fallback
    return getUserColor(currentUserId, currentUserId, selectedFriendIds);
  };

  if (isMinimized) {
    return (
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col items-center py-4 z-[500]">
        <button
          onClick={onToggleMinimize}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Show concert list"
        >
          <svg 
            className="w-6 h-6 text-gray-600 dark:text-gray-400" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 transform -rotate-90 whitespace-nowrap">
          {filteredConcerts.length} concerts
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col z-[500]">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Concerts
          </h2>
          <button
            onClick={onToggleMinimize}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Hide concert list"
          >
            <svg 
              className="w-5 h-5 text-gray-600 dark:text-gray-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search concerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 pl-9 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results count */}
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {selectedConcertIds.length > 0 ? (
            <>
              {filteredConcerts.length} concert{filteredConcerts.length !== 1 ? 's' : ''} at selected location
            </>
          ) : (
            <>
              {filteredConcerts.length} concert{filteredConcerts.length !== 1 ? 's' : ''} in this area
            </>
          )}
        </div>
      </div>

      {/* Concert List */}
      <div className="flex-1 overflow-y-auto">
        {filteredConcerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="text-4xl mb-3">🎸</div>
            <p className="text-gray-600 dark:text-gray-400">
              {searchQuery ? 'No concerts match your search' : 'No concerts to display'}
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {filteredConcerts.map((concert) => {
              const isShared = isConcertShared(concert.userInteractions);
              const color = getConcertColor(concert);
              const primaryArtist = getPrimaryArtist(concert);
              const isInterested = concert.userInteractions.some(ui => ui.interested);

              return (
                <div
                  key={concert.id}
                  className="relative p-2 rounded-lg border-2 transition-all hover:shadow-md group"
                  style={{
                    borderColor: color,
                    backgroundColor: `${color}10`,
                  }}
                >
                  {/* Header with date, interested star, and shared indicator */}
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-1">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                        {formatDate(concert.dateStart)}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleInterested(concert.id, isInterested);
                        }}
                        className="hover:scale-110 transition-transform"
                        title={isInterested ? "Remove from interested" : "Mark as interested"}
                      >
                        {isInterested ? (
                          <span className="text-yellow-500">⭐</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">☆</span>
                        )}
                      </button>
                    </div>
                    {isShared && (
                      <div className="text-sm" title="Shared concert">
                        {SHARED_CONCERT_EMOJI}
                      </div>
                    )}
                  </div>

                  {/* Event name with link */}
                  <a
                    href={`/concerts/${concert.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sm text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2 block mb-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {concert.eventName}
                  </a>

                  {/* Location */}
                  <div className="flex items-center text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <svg className="w-3 h-3 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="truncate">
                      {concert.city}, {concert.country.name}
                    </span>
                  </div>

                  {/* User indicators */}
                  {concert.userInteractions.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {concert.userInteractions.map((ui) => (
                        <div
                          key={ui.userId}
                          className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                          style={{ 
                            backgroundColor: getUserColor(ui.userId, currentUserId, selectedFriendIds) 
                          }}
                          title={ui.username}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

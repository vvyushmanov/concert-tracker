'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { MapFilters, MapConcert, MapFriend, TIMELINE_PRESETS } from '@/app/types/map';
import { getUserColor } from '@/app/lib/mapColors';

// Dynamically import client-only components (no SSR)
const ConcertMap = dynamic(() => import('./ConcertMap'), {
  ssr: false,
});

const TimelineSlider = dynamic(() => import('./TimelineSlider'), {
  ssr: false,
});

const ConcertSidebar = dynamic(() => import('./ConcertSidebar'), {
  ssr: false,
});

/**
 * Helper functions for date conversion
 * HTML5 date inputs require YYYY-MM-DD format and work with local dates (not UTC)
 */

// Convert Unix timestamp to YYYY-MM-DD string for date input
const unixToDateString = (unixTimestamp: number): string => {
  try {
    const date = new Date(unixTimestamp * 1000);
    if (isNaN(date.getTime())) return '';
    
    // Use local date components to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
};

// Convert YYYY-MM-DD string to Unix timestamp
const dateStringToUnix = (dateString: string, endOfDay: boolean = false): number | null => {
  // Empty string is valid for date inputs - means no value selected
  if (!dateString || dateString.trim() === '') return null;
  
  try {
    // Parse the date string as local date (YYYY-MM-DD)
    const [year, month, day] = dateString.split('-').map(Number);
    
    // Validate parsed values
    if (!year || !month || !day) return null;
    if (year < 1900 || year > 2100) return null; // Reasonable year range
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    
    // Create date in local timezone
    const date = new Date(year, month - 1, day);
    
    // Verify the date is valid (handles invalid dates like Feb 30)
    if (isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    
    return Math.floor(date.getTime() / 1000);
  } catch {
    return null;
  }
};

export default function MapClient() {
  const { data: session } = useSession();
  const [concerts, setConcerts] = useState<MapConcert[]>([]);
  const [friends, setFriends] = useState<MapFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('Next Year');
  const [showCustomDateRange, setShowCustomDateRange] = useState(false);
  
  // Sidebar state
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const [selectedConcertIds, setSelectedConcertIds] = useState<number[]>([]);
  const [visibleConcertIds, setVisibleConcertIds] = useState<number[]>([]);
  const [triggerViewportUpdate, setTriggerViewportUpdate] = useState(0);

  // Filter state
  const [filters, setFilters] = useState<MapFilters>({
    startDate: Math.floor(Date.now() / 1000),
    endDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year (matches timeline max)
    friendIds: [],
    artistIds: [],
    countryIds: [],
    interestedOnly: false,
    sharedOnly: false,
  });

  // Fetch friends list on mount
  useEffect(() => {
    fetchFriends();
  }, []);

  // Fetch concerts when filters change
  useEffect(() => {
    fetchConcerts();
  }, [filters]);

  const fetchFriends = async () => {
    try {
      const response = await fetch('/api/map/friends');
      if (!response.ok) throw new Error('Failed to fetch friends');
      const data = await response.json();
      setFriends(data.friends);
    } catch (err) {
      console.error('Error fetching friends:', err);
    }
  };

  const fetchConcerts = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        startDate: filters.startDate.toString(),
        endDate: filters.endDate.toString(),
        interestedOnly: filters.interestedOnly.toString(),
      });

      if (filters.friendIds.length > 0) {
        params.append('friendIds', filters.friendIds.join(','));
      }
      if (filters.artistIds.length > 0) {
        params.append('artistIds', filters.artistIds.join(','));
      }
      if (filters.countryIds.length > 0) {
        params.append('countryIds', filters.countryIds.join(','));
      }

      const response = await fetch(`/api/map/concerts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch concerts');
      
      const data = await response.json();
      setConcerts(data.concerts);
    } catch (err) {
      console.error('Error fetching concerts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load concerts');
    } finally {
      setLoading(false);
    }
  };

  // Filter concerts client-side for sharedOnly
  const filteredConcerts = useMemo(() => {
    if (!filters.sharedOnly) {
      return concerts;
    }
    // Only show concerts with more than 1 user interaction (shared)
    return concerts.filter(concert => concert.userInteractions.length > 1);
  }, [concerts, filters.sharedOnly]);

  // Handle concert selection from map or sidebar
  const handleConcertClick = (concertId: number) => {
    // For now, just select the single concert
    // In the future, this could be enhanced to support multi-select
    setSelectedConcertIds([concertId]);
  };

  // Handle marker click from map (can have multiple concerts at same location)
  const handleMarkerClick = (concertIds: number[]) => {
    setSelectedConcertIds(concertIds);
  };

  // Handle viewport change from map
  const handleViewportChange = (visibleIds: number[]) => {
    setVisibleConcertIds(visibleIds);
  };

  // Trigger viewport recalculation when filtered concerts change
  useEffect(() => {
    // When filters change (e.g., sharedOnly toggle, interestedOnly toggle), trigger map to recalculate viewport
    // Skip initial render (when concerts is empty array on mount)
    if (concerts.length > 0 || filteredConcerts.length > 0) {
      setTriggerViewportUpdate(prev => prev + 1);
    }
  }, [filteredConcerts, concerts]);

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900" style={{ height: 'calc(100vh - 3rem)' }}>
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Concert Map
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {loading ? 'Loading...' : `${filteredConcerts.length} concerts found`}
              {filters.interestedOnly && ' • Pinned only'}
              {filters.sharedOnly && ' • Shared only'}
              {filters.friendIds.length > 0 && ` • ${filters.friendIds.length} friend${filters.friendIds.length > 1 ? 's' : ''}`}
            </p>
          </div>
          
          {/* Quick Stats */}
          <div className="flex gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {filteredConcerts.length}
              </div>
              <div className="text-gray-600 dark:text-gray-400">Concerts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {filters.friendIds.length}
              </div>
              <div className="text-gray-600 dark:text-gray-400">Friends</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {Math.ceil((filters.endDate - filters.startDate) / (24 * 60 * 60))}
              </div>
              <div className="text-gray-600 dark:text-gray-400">Days</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Filters & Controls */}
        <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Timeline Selector */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Timeline
              </h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {TIMELINE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const now = Math.floor(Date.now() / 1000);
                      setFilters({
                        ...filters,
                        startDate: now,
                        endDate: now + (preset.days * 24 * 60 * 60),
                      });
                      setSelectedPreset(preset.label);
                      setShowCustomDateRange(false);
                    }}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      selectedPreset === preset.label && !showCustomDateRange
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              
              {/* Custom Date Range Toggle */}
              <button
                onClick={() => setShowCustomDateRange(!showCustomDateRange)}
                className={`w-full px-3 py-2 text-sm rounded-lg border transition-colors ${
                  showCustomDateRange
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                📅 Custom Range
              </button>
              
              {/* Custom Date Range Inputs */}
              {showCustomDateRange && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={unixToDateString(filters.startDate)}
                      onChange={(e) => {
                        const value = e.target.value;
                        // HTML5 date input provides empty string when cleared
                        if (value === '') return;
                        
                        const unixTimestamp = dateStringToUnix(value);
                        if (unixTimestamp !== null) {
                          setFilters((prev) => ({
                            ...prev,
                            startDate: unixTimestamp,
                          }));
                        }
                      }}
                      min={unixToDateString(Math.floor(Date.now() / 1000))}
                      max={unixToDateString(filters.endDate)}
                      className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={unixToDateString(filters.endDate)}
                      onChange={(e) => {
                        const value = e.target.value;
                        // HTML5 date input provides empty string when cleared
                        if (value === '') return;
                        
                        const unixTimestamp = dateStringToUnix(value, true);
                        if (unixTimestamp !== null) {
                          setFilters((prev) => ({
                            ...prev,
                            endDate: unixTimestamp,
                          }));
                        }
                      }}
                      min={unixToDateString(filters.startDate)}
                      max={unixToDateString(Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60))} // 1 year from now
                      className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 pt-1">
                    {Math.ceil((filters.endDate - filters.startDate) / (24 * 60 * 60))} days selected
                  </div>
                </div>
              )}
            </div>

            {/* Friends Selector */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Friends ({filters.friendIds.length}/5)
              </h3>
              <div className="space-y-2">
                {/* Current User Legend */}
                <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div 
                    className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                    style={{ 
                      backgroundColor: getUserColor(
                        session ? parseInt(session.user.id) : 0, 
                        session ? parseInt(session.user.id) : 0, 
                        filters.friendIds
                      )
                    }}
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    You
                  </span>
                </div>

                {/* Friends List */}
                {friends.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 pt-2">
                    No friends yet. Add friends to see their concerts!
                  </p>
                ) : (
                  friends.map((friend) => (
                    <label
                      key={friend.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filters.friendIds.includes(friend.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (filters.friendIds.length < 5) {
                              setFilters({
                                ...filters,
                                friendIds: [...filters.friendIds, friend.id],
                              });
                            }
                          } else {
                            setFilters({
                              ...filters,
                              friendIds: filters.friendIds.filter(id => id !== friend.id),
                            });
                          }
                        }}
                        disabled={!filters.friendIds.includes(friend.id) && filters.friendIds.length >= 5}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      <div 
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ 
                          backgroundColor: getUserColor(
                            friend.id, 
                            session ? parseInt(session.user.id) : 0, 
                            filters.friendIds
                          )
                        }}
                      />
                      <span className="text-sm text-gray-900 dark:text-white">
                        {friend.username}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Filters */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Filters
              </h3>
              <div className="space-y-1">
                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.interestedOnly}
                    onChange={(e) => setFilters({ ...filters, interestedOnly: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-900 dark:text-white">
                    ⭐ Pinned concerts only
                  </span>
                </label>
                <label 
                  className={`flex items-center gap-2 p-2 rounded-lg ${
                    filters.friendIds.length > 0 
                      ? 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer' 
                      : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={filters.sharedOnly}
                    onChange={(e) => {
                      if (filters.friendIds.length > 0) {
                        setFilters({ ...filters, sharedOnly: e.target.checked });
                      }
                    }}
                    disabled={filters.friendIds.length === 0}
                    className="rounded border-gray-300 dark:border-gray-600 disabled:opacity-50"
                  />
                  <span className="text-sm text-gray-900 dark:text-white">
                    🔥 Shared concerts only
                  </span>
                </label>
              </div>
            </div>

            {/* Clear Filters Button */}
            {(filters.friendIds.length > 0 || filters.interestedOnly || filters.sharedOnly) && (
              <button
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000);
                  setFilters({
                    startDate: now,
                    endDate: now + (90 * 24 * 60 * 60),
                    friendIds: [],
                    artistIds: [],
                    countryIds: [],
                    interestedOnly: false,
                    sharedOnly: false,
                  });
                  setSelectedPreset('Next 3 Months');
                  setShowCustomDateRange(false);
                }}
                className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                🗑️ Clear All Filters
              </button>
            )}
          </div>
        </div>

        {/* Map Container with Sidebar */}
        <div className="flex-1 flex relative">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400 mb-2">❌ {error}</p>
                <button
                  onClick={fetchConcerts}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80 dark:bg-gray-900/80">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading concerts...</p>
                  </div>
                </div>
              )}
              {!loading && filteredConcerts.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-100 dark:bg-gray-800">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🎸</div>
                    <p className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      No concerts found
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      Try adjusting your filters or date range
                    </p>
                  </div>
                </div>
              )}
              {/* Map */}
              <div 
                className="flex-1 relative transition-all duration-300"
                style={{ 
                  marginRight: isSidebarMinimized ? '48px' : '384px' 
                }}
              >
                <ConcertMap
                  key="concert-map-singleton"
                  concerts={filteredConcerts}
                  currentUserId={session ? parseInt(session.user.id) : 0}
                  selectedFriendIds={filters.friendIds}
                  onMarkerClick={handleMarkerClick}
                  onViewportChange={handleViewportChange}
                  sidebarMinimized={isSidebarMinimized}
                  triggerViewportUpdate={triggerViewportUpdate}
                />
                <TimelineSlider
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  minDate={Math.floor(Date.now() / 1000)}
                  maxDate={Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)} // 1 year
                  onChange={(start, end) => {
                    setFilters({ ...filters, startDate: start, endDate: end });
                    setSelectedPreset('Custom');
                    setShowCustomDateRange(false);
                  }}
                />
              </div>

              {/* Concert Sidebar */}
              <ConcertSidebar
                concerts={filteredConcerts}
                currentUserId={session ? parseInt(session.user.id) : 0}
                selectedFriendIds={filters.friendIds}
                selectedConcertIds={selectedConcertIds}
                visibleConcertIds={visibleConcertIds}
                onConcertClick={handleConcertClick}
                isMinimized={isSidebarMinimized}
                onToggleMinimize={() => setIsSidebarMinimized(!isSidebarMinimized)}
                onConcertsUpdate={fetchConcerts}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

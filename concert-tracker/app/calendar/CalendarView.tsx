'use client';

import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths, isToday, isBefore, startOfDay } from 'date-fns';
import Link from 'next/link';

type Concert = {
  id: number;
  eventName: string;
  eventUrl: string;
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
  };
};

type CalendarViewProps = {
  initialConcerts: Concert[];
  artists: { id: number; name: string }[];
  countries: string[];
  cities: { city: string; country: string }[];
};

export default function CalendarView({ initialConcerts, artists, countries, cities }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedArtist, setSelectedArtist] = useState<number | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showInterestedOnly, setShowInterestedOnly] = useState(false);
  const [showPastEvents, setShowPastEvents] = useState(false);

  const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp

  // Filter cities based on selected country
  const availableCities = selectedCountry
    ? cities.filter(c => c.country === selectedCountry).map(c => c.city)
    : cities.map(c => c.city);

  // Remove duplicates and sort
  const uniqueCities = Array.from(new Set(availableCities)).sort();

  // Reset city selection if it's not in available cities when country changes
  useEffect(() => {
    if (selectedCity && !uniqueCities.includes(selectedCity)) {
      setSelectedCity(null);
    }
  }, [selectedCountry, selectedCity, uniqueCities]);

  // Filter concerts
  const filteredConcerts = initialConcerts.filter(concert => {
    // Artist filter - check if artist performs at this concert (any role)
    if (selectedArtist && concert.artists && !concert.artists.some((ac: any) => ac.artistId === selectedArtist)) return false;
    // Country filter
    if (selectedCountry && concert.countryObj?.name !== selectedCountry) return false;
    if (selectedCity && concert.cityMapping.cityNormalized.normalizedCity !== selectedCity) return false;
    if (showInterestedOnly && !concert.interested) return false;
    return true;
  });

  // Calendar calculations
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Group concerts by date
  const concertsByDate = filteredConcerts.reduce((acc, concert) => {
    const dateKey = format(new Date(concert.dateStart * 1000), 'yyyy-MM-dd');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(concert);
    return acc;
  }, {} as Record<string, Concert[]>);

  // Get concerts for selected day
  const selectedDayConcerts = selectedDay 
    ? concertsByDate[format(selectedDay, 'yyyy-MM-dd')] || []
    : [];

  // Split into upcoming and past
  const upcomingConcerts = filteredConcerts.filter(c => c.dateStart >= now);
  const pastConcerts = filteredConcerts.filter(c => c.dateStart < now);

  return (
    <div className="flex gap-4 flex-1 overflow-hidden">
      {/* Left Sidebar - Filters */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 h-full overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">Filters</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Artist</label>
              <select
                value={selectedArtist || ''}
                onChange={(e) => setSelectedArtist(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
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
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              >
                <option value="">All Countries</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">City</label>
              <select
                value={selectedCity || ''}
                onChange={(e) => setSelectedCity(e.target.value || null)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                disabled={uniqueCities.length === 0}
              >
                <option value="">{selectedCountry ? 'All Cities' : 'Select Country First'}</option>
                {uniqueCities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
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

            <button
              onClick={() => {
                setSelectedArtist(null);
                setSelectedCountry(null);
                setSelectedCity(null);
                setShowInterestedOnly(false);
              }}
              className="w-full px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(600px,1fr),420px] gap-4 flex-1 overflow-hidden">
        {/* Left Column - Calendar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ← Previous
            </button>
            
            <h2 className="text-lg font-bold">
              {format(currentMonth, 'MMMM yyyy')}
            </h2>
            
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Next →
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1 flex-shrink-0">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center font-semibold text-gray-600 dark:text-gray-400 py-0.5 text-xs">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1 flex-1" style={{ gridAutoRows: '1fr' }}>
          {days.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const dayConcerts = concertsByDate[dateKey] || [];
            const isCurrentDay = isToday(day);
            const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
            const isPast = isBefore(day, startOfDay(new Date()));
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            const hasInterested = dayConcerts.some(c => c.interested);

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(isSameDay(day, selectedDay || new Date('1970-01-01')) ? null : day)}
                className={`
                  h-full p-1.5 border rounded text-left transition-all text-xs
                  ${isCurrentDay ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 dark:border-gray-700'}
                  ${!isCurrentMonth ? 'opacity-40' : ''}
                  ${isPast ? 'bg-gray-50 dark:bg-gray-900' : ''}
                  ${dayConcerts.length > 0 && !isPast ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}
                  ${isSelected ? 'ring-2 ring-purple-500' : ''}
                  ${hasInterested ? 'border-yellow-400' : ''}
                `}
              >
                <div className={`text-xs font-semibold mb-0.5 ${isCurrentDay ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                  {format(day, 'd')}
                </div>
                
                {dayConcerts.length > 0 && (
                  <div className="space-y-0.5">
                    {dayConcerts.slice(0, 1).map((concert) => (
                      <div
                        key={concert.id}
                        className={`text-[10px] px-1 py-0.5 rounded truncate ${
                          concert.interested 
                            ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100'
                            : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        }`}
                        title={`${concert.artist.name} - ${concert.eventName}`}
                      >
                        {concert.interested && '⭐'}{concert.artist.name}
                      </div>
                    ))}
                    {dayConcerts.length > 1 && (
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 pl-0.5">
                        +{dayConcerts.length - 1} more
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          </div>
        </div>

        {/* Right Column - Concerts List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 overflow-y-auto">
          {selectedDay && selectedDayConcerts.length > 0 ? (
            <>
              <h3 className="text-lg font-bold mb-3 sticky -top-5 bg-white dark:bg-gray-800 pt-5 pb-2 z-10">
                Concerts on {format(selectedDay, 'MMMM d, yyyy')}
              </h3>
              <div className="space-y-2">
                {selectedDayConcerts.map((concert) => (
                  <div
                    key={concert.id}
                    className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <Link href={`/concerts/${concert.id}`} className="flex-1 hover:opacity-80">
                        {concert.interested && (
                          <span className="inline-block px-2 py-1 bg-yellow-400 text-yellow-900 text-xs font-bold rounded mb-2">
                            ⭐ Interested
                          </span>
                        )}
                        <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                          {concert.artist.name}
                        </div>
                        <h4 className="font-bold mb-1">{concert.eventName}</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          📍 {concert.venue}, {concert.cityMapping.originalCity}, {concert.countryObj?.name}
                        </p>
                      </Link>
                      <a
                        href={concert.eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-4 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Tickets
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between sticky -top-5 bg-white dark:bg-gray-800 pt-5 pb-3 mb-3 z-10">
                <h3 className="text-lg font-bold">
                  Upcoming Concerts ({upcomingConcerts.length})
                </h3>
                {pastConcerts.length > 0 && (
                  <button
                    onClick={() => setShowPastEvents(!showPastEvents)}
                    className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    {showPastEvents ? 'Hide' : 'Show'} Past ({pastConcerts.length})
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {upcomingConcerts.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">No upcoming concerts found.</p>
                ) : (
                  upcomingConcerts.map((concert) => {
                    const startDate = new Date(concert.dateStart * 1000);

                    return (
                      <div
                        key={concert.id}
                        className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 transition-colors"
                      >
                        <div className="text-center min-w-12">
                          <div className="text-xl font-bold">{format(startDate, 'd')}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">{format(startDate, 'MMM')}</div>
                        </div>
                        
                        <Link href={`/concerts/${concert.id}`} className="flex-1 hover:opacity-80">
                          {concert.interested && (
                            <span className="inline-block px-2 py-1 bg-yellow-400 text-yellow-900 text-xs font-bold rounded mb-1">
                              ⭐ Interested
                            </span>
                          )}
                          <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {concert.artist.name}
                          </div>
                          <h4 className="font-bold">{concert.eventName}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            📍 {concert.venue}, {concert.cityMapping.originalCity}, {concert.countryObj?.name}
                          </p>
                        </Link>
                        
                        <a
                          href={concert.eventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium whitespace-nowrap"
                        >
                          View Event
                        </a>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Past Concerts */}
              {showPastEvents && pastConcerts.length > 0 && (
                <>
                  <h3 className="text-lg font-bold mt-4 mb-3 text-gray-500 dark:text-gray-400">
                    Past Concerts
                  </h3>
                  <div className="space-y-2 opacity-75">
                    {pastConcerts.map((concert) => {
                      const startDate = new Date(concert.dateStart * 1000);

                      return (
                        <div
                          key={concert.id}
                          className="flex items-center gap-4 bg-gray-50 dark:bg-gray-700 rounded-lg p-4 transition-colors"
                        >
                          <div className="text-center min-w-16">
                            <div className="text-2xl font-bold">{format(startDate, 'd')}</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">{format(startDate, 'MMM')}</div>
                          </div>
                          
                          <Link href={`/concerts/${concert.id}`} className="flex-1 hover:opacity-80">
                            {concert.interested && (
                              <span className="inline-block px-2 py-1 bg-yellow-400 text-yellow-900 text-xs font-bold rounded mb-1">
                                ⭐ Interested
                              </span>
                            )}
                            <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                              {concert.artist.name}
                            </div>
                            <h4 className="font-bold">{concert.eventName}</h4>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              📍 {concert.venue}, {concert.cityMapping.originalCity}, {concert.countryObj?.name}
                            </p>
                          </Link>
                          
                          <a
                            href={concert.eventUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-xs font-medium whitespace-nowrap"
                          >
                            View Event
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

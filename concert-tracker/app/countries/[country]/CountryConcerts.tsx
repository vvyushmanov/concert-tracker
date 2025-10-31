'use client';

import { useState } from 'react';
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
  city: string;
  interested: boolean;
  artist: {
    id: number;
    name: string;
  };
};

type CountryConcertsProps = {
  concerts: Concert[];
};

export default function CountryConcerts({ concerts }: CountryConcertsProps) {
  const [showPastEvents, setShowPastEvents] = useState(false);
  
  const now = Math.floor(Date.now() / 1000);
  
  // Split concerts into upcoming and past
  const upcomingConcerts = concerts.filter(c => c.dateStart >= now);
  const pastConcerts = concerts.filter(c => c.dateStart < now);
  
  // Group by city
  const groupByCity = (concertList: Concert[]) => {
    return concertList.reduce((acc, concert) => {
      if (!acc[concert.city]) {
        acc[concert.city] = [];
      }
      acc[concert.city].push(concert);
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
        {concert.interested && (
          <div className="absolute top-2 right-2 z-10 bg-yellow-400 text-yellow-900 px-2 py-1 rounded-full text-xs font-bold">
            ⭐ Pinned
          </div>
        )}
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
          <div className="mb-2">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              {concert.artist.name}
            </span>
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
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="space-y-8">
      {/* Stats and Toggle */}
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
          {Object.entries(upcomingByCity).map(([city, cityConcerts]) => (
            <div key={city}>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span>📍</span>
                <span>{city}</span>
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
          {Object.entries(pastByCity).map(([city, cityConcerts]) => (
            <div key={city}>
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <span>📍</span>
                <span>{city}</span>
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

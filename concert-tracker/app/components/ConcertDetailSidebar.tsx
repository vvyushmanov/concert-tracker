'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';

interface Concert {
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
  postalCode: string | null;
  performers: string[];
  imageUrl: string | null;
  organizer: string | null;
  organizerUrl: string | null;
  ticketLinks: string[];
  interested: boolean;
  notes: string | null;
  isPrivate: boolean;
  artists: {
    id: number;
    artistId: number;
    isPrimary: boolean;
    artist: {
      id: number;
      name: string;
      imageUrl: string | null;
      playcount?: number;
    };
  }[];
}

interface ConcertDetailSidebarProps {
  concertId: number | null;
  onClose: () => void;
}

export default function ConcertDetailSidebar({ concertId, onClose }: ConcertDetailSidebarProps) {
  const [concert, setConcert] = useState<Concert | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    if (!concertId) {
      setConcert(null);
      return;
    }

    const fetchConcert = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/concerts/${concertId}`);
        if (response.ok) {
          const data = await response.json();
          setConcert(data);
          setEditNotes(data.notes || '');
        }
      } catch (err) {
        console.error('Failed to load concert:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConcert();
  }, [concertId]);

  const toggleInterested = async () => {
    if (!concert) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/concerts/${concert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interested: !concert.interested }),
      });
      
      if (response.ok) {
        const updated = await response.json();
        setConcert(updated);
      }
    } catch (err) {
      console.error('Failed to update interested status:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const togglePrivacy = async () => {
    if (!concert) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/concerts/${concert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: !concert.isPrivate }),
      });
      
      if (response.ok) {
        const updated = await response.json();
        setConcert(updated);
      }
    } catch (err) {
      console.error('Failed to update privacy status:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const saveNotes = async () => {
    if (!concert) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/concerts/${concert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editNotes || null }),
      });
      
      if (response.ok) {
        const updated = await response.json();
        setConcert(updated);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!concertId) return null;

  const startDate = concert ? new Date(concert.dateStart * 1000) : null;
  const endDate = concert ? new Date(concert.dateEnd * 1000) : null;
  const isSameDay = concert ? concert.dateStart === concert.dateEnd : true;

  return (
    <>
      {/* Side-panel with slide animation - no backdrop */}
      <div 
        className={`bg-white dark:bg-gray-800 shadow-2xl overflow-y-auto transition-all duration-300 ease-out border-l border-gray-200 dark:border-gray-700 ${
          concertId ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ 
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : (typeof window !== 'undefined' && window.innerWidth < 1024 ? '500px' : '600px'),
          zIndex: 1000
        }}
      >
        {/* Close button - inside panel header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Concert Details</h2>
          <button
            onClick={onClose}
            className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full p-2 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 group"
            aria-label="Close"
          >
            <svg className="w-5 h-5 group-hover:rotate-90 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-gray-200 dark:border-gray-700 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-600 dark:border-blue-500 rounded-full border-t-transparent animate-spin"></div>
            </div>
            <div className="text-lg font-medium text-gray-600 dark:text-gray-400">Loading concert details...</div>
          </div>
        ) : concert ? (
          <div className="p-6">
            {/* Concert Image */}
            {concert.imageUrl && (
              <div 
                className="w-full h-56 relative bg-gray-900 rounded-lg overflow-hidden mb-6 cursor-pointer group"
                onClick={() => setShowImageModal(true)}
              >
                <Image
                  src={concert.imageUrl}
                  alt={concert.eventName}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  priority
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white/90 dark:bg-gray-800/90 rounded-full p-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* Header: Title + Action Buttons */}
            <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex-1 min-w-0">
                <Link href={`/concerts/${concert.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <h1 className="text-2xl font-bold mb-2">{concert.eventName}</h1>
                </Link>
                {concert.isPrivate && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs font-medium">
                    🔒 Hidden from friends
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button
                  onClick={toggleInterested}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    concert.interested
                      ? 'bg-yellow-400 dark:bg-yellow-600 text-yellow-900 dark:text-yellow-100 hover:bg-yellow-500 dark:hover:bg-yellow-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  {concert.interested ? '⭐' : '☆'}
                </button>
                <button
                  onClick={togglePrivacy}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    concert.isPrivate
                      ? 'bg-purple-500 dark:bg-purple-600 text-white hover:bg-purple-600 dark:hover:bg-purple-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  } disabled:opacity-50`}
                  title={concert.isPrivate ? 'Hidden from friends on map' : 'Visible to friends on map'}
                >
                  {concert.isPrivate ? '🔒' : '🌐'}
                </button>
              </div>
            </div>

            {/* Event Details */}
            <div className="space-y-4 mb-6">
              {/* Your Artists */}
              {concert.artists && concert.artists.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🎸 Your Artists</div>
                  <div className="flex flex-wrap gap-2">
                    {concert.artists
                      .filter(ac => ac.artist.playcount && ac.artist.playcount > 0)
                      .map(ac => (
                        <Link
                          key={ac.id}
                          href={`/artists/${ac.artistId}`}
                          onClick={onClose}
                          className={`inline-block px-3 py-1 rounded-full text-sm font-semibold transition-colors ${
                            ac.isPrimary
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
                          }`}
                        >
                          {ac.artist.name}
                        </Link>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* Date */}
              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">📅 Date</div>
                <div className="text-gray-900 dark:text-gray-100">
                  {startDate && format(startDate, 'EEEE, MMMM dd, yyyy')}
                  {!isSameDay && endDate && (
                    <>
                      <br />
                      <span className="text-sm text-gray-600 dark:text-gray-400">to {format(endDate, 'EEEE, MMMM dd, yyyy')}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Location */}
              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">📍 Location</div>
                <div className="text-gray-900 dark:text-gray-100">
                  {concert.venue}
                  <br />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {concert.cityMapping.originalCity}, {concert.countryObj?.name}
                    {concert.postalCode && ` ${concert.postalCode}`}
                  </span>
                </div>
              </div>

              {/* Performers */}
              {concert.performers.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🎤 Performers</div>
                  <div className="text-gray-900 dark:text-gray-100">
                    {concert.performers.join(', ')}
                  </div>
                </div>
              )}

              {/* Organizer */}
              {concert.organizer && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🎪 Organizer</div>
                  <div className="text-gray-900 dark:text-gray-100">
                    {concert.organizerUrl ? (
                      <a
                        href={concert.organizerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {concert.organizer}
                      </a>
                    ) : (
                      concert.organizer
                    )}
                  </div>
                </div>
              )}

              {/* Tickets & Event Link */}
              <div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🎫 Tickets & Info</div>
                <div className="flex flex-wrap gap-2">
                  {concert.ticketLinks.length > 0 && concert.ticketLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      🎫 Tickets {concert.ticketLinks.length > 1 && `#${index + 1}`}
                    </a>
                  ))}
                  <a
                    href={concert.eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 text-sm bg-gray-700 dark:bg-gray-600 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    🔗 Event Details
                  </a>
                </div>
              </div>
            </div>

            {/* Personal Notes */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">📝 Personal Notes</div>
              {isEditing ? (
                <div>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-2.5"
                    rows={3}
                    placeholder="Add your personal notes about this concert..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveNotes}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditNotes(concert.notes || '');
                      }}
                      className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {concert.notes ? (
                    <p className="text-gray-600 dark:text-gray-400 mb-2.5 whitespace-pre-wrap">
                      {concert.notes}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500 mb-2.5 italic">
                      No notes yet
                    </p>
                  )}
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {concert.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Image Modal/Lightbox */}
      {showImageModal && concert?.imageUrl && (
        <div 
          className="bg-black/90 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
          style={{ 
            position: 'fixed',
            inset: 0,
            margin: 0,
            padding: '1rem',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000 
          }}
          onClick={() => setShowImageModal(false)}
        >
          <button
            onClick={() => setShowImageModal(false)}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-all duration-200 group"
            aria-label="Close image"
          >
            <svg className="w-6 h-6 group-hover:rotate-90 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative max-w-5xl max-h-[90vh] w-full h-full" onClick={(e) => e.stopPropagation()}>
            <Image
              src={concert.imageUrl}
              alt={concert.eventName}
              fill
              className="object-contain"
              priority
            />
          </div>
        </div>
      )}
    </>
  );
}

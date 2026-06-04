'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
      followed?: boolean;
    };
  }[];
}

export default function ConcertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [concert, setConcert] = useState<Concert | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchConcert = async () => {
      try {
        const response = await fetch(`/api/concerts/${params.id}`);
        if (!response.ok) {
          throw new Error('Concert not found');
        }
        const data = await response.json();
        setConcert(data);
        setEditNotes(data.notes || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load concert');
      } finally {
        setLoading(false);
      }
    };

    fetchConcert();
  }, [params.id]);

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

  if (loading) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error || !concert) {
    return (
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Concert Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to all concerts
          </Link>
        </div>
      </div>
    );
  }

  const startDate = new Date(concert.dateStart * 1000);
  const endDate = new Date(concert.dateEnd * 1000);
  const isSameDay = concert.dateStart === concert.dateEnd;

  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      {/* Back button - minimal padding */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
        >
          ← Back to concerts
        </Link>
      </div>

      {/* Main content - account for navbar (3rem) and back button (~44px) */}
      <main className="px-40 py-10" style={{ height: 'calc(100vh - 3rem - 44px)' }}>
        <div className="h-full bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden">
          {/* Horizontal layout: image left (poster ratio ~0.8:1), content right */}
          <div className="flex flex-col lg:flex-row h-full p-6">
            {/* Concert Image - poster aspect ratio (728x911 ≈ 4:5) */}
            {concert.imageUrl && (
              <div className="w-full lg:w-[28%] lg:flex-shrink-0 h-64 lg:h-full relative bg-gray-900 rounded-lg overflow-hidden lg:mr-6">
                <Image
                  src={concert.imageUrl}
                  alt={concert.eventName}
                  fill
                  className="object-contain"
                  priority
                />
              </div>
            )}

            {/* Content area - scrollable */}
            <div className="flex-1 overflow-y-auto mt-4 lg:mt-0">
            {/* Header: Title + Action Buttons */}
            <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold mb-2">{concert.eventName}</h1>
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

            {/* Two-column grid for event details */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 mb-6">
              {/* Left Column */}
              <div className="space-y-4">
                {/* Your Artists */}
                {concert.artists && concert.artists.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🎸 Your Artists</div>
                    <div className="flex flex-wrap gap-2">
                      {concert.artists
                        .filter(ac => ac.artist.followed)
                        .map(ac => (
                          <Link
                            key={ac.id}
                            href={`/artists/${ac.artistId}`}
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
                    {format(startDate, 'EEEE, MMMM dd, yyyy')}
                    {!isSameDay && (
                      <>
                        <br />
                        <span className="text-sm text-gray-600 dark:text-gray-400">to {format(endDate, 'EEEE, MMMM dd, yyyy')}</span>
                      </>
                    )}
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
              </div>

              {/* Right Column */}
              <div className="space-y-4">
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
            </div>

            {/* Personal Notes */}
            <div>
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
          </div>
        </div>
      </main>
    </div>
  );
}

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
  city: string;
  country: string;
  postalCode: string | null;
  performers: string[];
  imageUrl: string | null;
  organizer: string | null;
  organizerUrl: string | null;
  ticketLinks: string[];
  interested: boolean;
  notes: string | null;
  artist: {
    id: number;
    name: string;
    imageUrl: string | null;
  };
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
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-4xl mx-auto">
        {/* Back button */}
        <Link
          href="/"
          className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline mb-6"
        >
          ← Back to all concerts
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          {/* Concert Image */}
          {concert.imageUrl && (
            <div className="w-full h-96 relative">
              <Image
                src={concert.imageUrl}
                alt={concert.eventName}
                fill
                className="object-cover"
                priority
              />
            </div>
          )}

          <div className="p-8">
            {/* Artist Badge */}
            <Link
              href={`/artists/${concert.artist.id}`}
              className="inline-block mb-4 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              {concert.artist.name}
            </Link>

            {/* Event Title */}
            <h1 className="text-4xl font-bold mb-6">{concert.eventName}</h1>

            {/* Pin Button */}
            <button
              onClick={toggleInterested}
              disabled={isSaving}
              className={`mb-6 px-6 py-3 rounded-lg font-medium transition-colors ${
                concert.interested
                  ? 'bg-yellow-400 dark:bg-yellow-600 text-yellow-900 dark:text-yellow-100 hover:bg-yellow-500 dark:hover:bg-yellow-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              } disabled:opacity-50`}
            >
              {concert.interested ? '⭐ Pinned' : '☆ Pin Concert'}
            </button>

            {/* Event Details */}
            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📅</span>
                <div>
                  <div className="font-semibold">Date</div>
                  <div className="text-gray-600 dark:text-gray-400">
                    {format(startDate, 'EEEE, MMMM dd, yyyy')}
                    {!isSameDay && ` - ${format(endDate, 'EEEE, MMMM dd, yyyy')}`}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="text-2xl">📍</span>
                <div>
                  <div className="font-semibold">Location</div>
                  <div className="text-gray-600 dark:text-gray-400">
                    {concert.venue}
                    <br />
                    {concert.city}, {concert.country}
                    {concert.postalCode && ` ${concert.postalCode}`}
                  </div>
                </div>
              </div>

              {concert.performers.length > 0 && (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🎤</span>
                  <div>
                    <div className="font-semibold">Performers</div>
                    <div className="text-gray-600 dark:text-gray-400">
                      {concert.performers.join(', ')}
                    </div>
                  </div>
                </div>
              )}

              {concert.organizer && (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🎪</span>
                  <div>
                    <div className="font-semibold">Organizer</div>
                    <div className="text-gray-600 dark:text-gray-400">
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
                </div>
              )}
            </div>

            {/* Ticket Links */}
            {concert.ticketLinks.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-bold mb-3">Get Tickets</h2>
                <div className="flex flex-wrap gap-3">
                  {concert.ticketLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Buy Tickets {concert.ticketLinks.length > 1 && `#${index + 1}`}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Event Link */}
            <a
              href={concert.eventUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mb-8 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              View Full Event Details →
            </a>

            {/* Personal Notes */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h2 className="text-xl font-bold mb-3">Personal Notes</h2>
              {isEditing ? (
                <div>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3"
                    rows={4}
                    placeholder="Add your personal notes about this concert..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveNotes}
                      disabled={isSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditNotes(concert.notes || '');
                      }}
                      className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {concert.notes ? (
                    <p className="text-gray-600 dark:text-gray-400 mb-3 whitespace-pre-wrap">
                      {concert.notes}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500 mb-3 italic">
                      No notes yet
                    </p>
                  )}
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {concert.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

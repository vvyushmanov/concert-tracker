'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SearchHit = { id: number; name: string; imageUrl: string | null; following: boolean };

export default function ArtistManager({ followedCount }: { followedCount: number }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function syncLastfm() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/artists/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: 'err', text: data.error || 'Sync failed.' });
      } else {
        setMessage({ kind: 'ok', text: `Synced ${data.synced} artists (${data.created} new, ${data.updated} updated).` });
        router.refresh();
      }
    } catch {
      setMessage({ kind: 'err', text: 'Sync failed (network).' });
    } finally {
      setSyncing(false);
    }
  }

  async function runSearch(query: string) {
    const v = query.trim();
    if (v.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/artists/search?q=${encodeURIComponent(v)}`);
      const data = await res.json();
      setHits(data.artists || []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  function onSearchChange(v: string) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(v), 300);
  }

  async function follow(opts: { artistId?: number; name?: string }) {
    setBusyId(opts.artistId ?? opts.name ?? null);
    try {
      await fetch('/api/user-artists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      await runSearch(q); // re-fetch so the result list (and the "Add & follow" row) reflect the new state
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function unfollow(artistId: number) {
    setBusyId(artistId);
    try {
      await fetch(`/api/user-artists?artistId=${artistId}`, { method: 'DELETE' });
      await runSearch(q);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const exactHit = hits.some((h) => h.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Your followed artists</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Following <span className="font-semibold">{followedCount}</span> artists — these drive which concerts you see.
          </p>
        </div>
        <button
          onClick={syncLastfm}
          disabled={syncing}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            syncing ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {syncing ? 'Syncing…' : '🔄 Sync from Last.fm'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 text-sm rounded-md px-3 py-2 ${message.kind === 'ok' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'}`}>
          {message.text}
        </div>
      )}

      {/* Search-to-add */}
      <div className="relative">
        <label className="block text-sm font-medium mb-2">Follow an artist</label>
        <input
          type="text"
          placeholder="Search artists to follow…"
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {q.trim().length >= 2 && (
          <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-72 overflow-y-auto">
            {searching && <div className="px-4 py-3 text-sm text-gray-500">Searching…</div>}
            {!searching && hits.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500">No matches in the database.</div>
            )}
            {hits.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm">{h.name}</span>
                {h.following ? (
                  <button onClick={() => unfollow(h.id)} disabled={busyId === h.id} className="text-xs px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600">
                    Following ✓
                  </button>
                ) : (
                  <button onClick={() => follow({ artistId: h.id })} disabled={busyId === h.id} className="text-xs px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white">
                    + Follow
                  </button>
                )}
              </div>
            ))}
            {!searching && !exactHit && (
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900/40">
                <span className="text-sm text-gray-600 dark:text-gray-400">Add new artist “{q.trim()}”</span>
                <button onClick={() => follow({ name: q.trim() })} disabled={busyId === q.trim()} className="text-xs px-3 py-1 rounded-full bg-green-600 hover:bg-green-700 text-white">
                  + Add &amp; follow
                </button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

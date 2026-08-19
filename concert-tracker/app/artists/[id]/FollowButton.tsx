'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FollowButton({
  artistId,
  initialFollowing,
}: {
  artistId: number;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    try {
      if (following) {
        await fetch(`/api/user-artists?artistId=${artistId}`, { method: 'DELETE' });
        setFollowing(false);
      } else {
        await fetch('/api/user-artists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artistId }),
        });
        setFollowing(true);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={following ? 'Click to unfollow' : 'Follow this artist'}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap ${
        following
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-red-600 hover:text-white'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      }`}
    >
      {busy ? '…' : following ? '✓ Following' : '+ Follow'}
    </button>
  );
}

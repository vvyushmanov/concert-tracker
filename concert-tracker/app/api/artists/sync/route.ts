import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { spawn } from 'child_process';
import { enrichUserMetadata } from '@/lib/metadataJobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // a Last.fm pull can take a while for big libraries

/**
 * POST /api/artists/sync
 * Refresh the current user's followed artists from their Last.fm top artists
 * (decoupled from concert scraping). Spawns scripts/sync_user_artists.py.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  const result = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const proc = spawn(
      'python3',
      ['-u', '/app/scripts/sync_user_artists.py', '--user-id', String(userId), '--no-color-log'],
      { cwd: '/app/scripts' }
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    proc.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });

  // Exit code 2 = Last.fm not configured for this user.
  if (result.code === 2) {
    return NextResponse.json(
      { error: 'Last.fm is not configured for your account. Add a Last.fm username in Settings, or follow artists manually.' },
      { status: 400 }
    );
  }
  if (result.code !== 0) {
    console.error(`artist sync failed for user ${userId}:`, result.err.slice(-1000));
    return NextResponse.json({ error: 'Sync failed. Check server logs.' }, { status: 500 });
  }

  const match = result.out.match(/SYNC_RESULT (\{.*\})/);
  const stats = match ? JSON.parse(match[1]) : { synced: 0, created: 0, updated: 0 };
  // Enrich newly-synced artists' metadata (MBID + image) in the background.
  if (stats.created > 0) {
    enrichUserMetadata(userId);
  }
  return NextResponse.json(stats);
}

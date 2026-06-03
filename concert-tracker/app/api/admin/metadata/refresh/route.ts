import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { auth } from '@/auth';
import { globalMetadataRefreshState } from '../../../state';

/**
 * Admin-only GLOBAL metadata refresh: enriches ALL artists (MBID + images) with
 * no user filter. Runs scripts/fetch_metadata.py without --user-id. Long-running
 * (MusicBrainz is rate-limited), so it runs in the background; poll GET for status.
 */
export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (globalMetadataRefreshState.isRefreshing) {
    return NextResponse.json({ error: 'A global metadata refresh is already running' }, { status: 409 });
  }

  try {
    const proc = spawn(
      'python3',
      ['-u', '/app/scripts/fetch_metadata.py', '--no-color-log'],
      { cwd: '/app/scripts' }
    );
    globalMetadataRefreshState.isRefreshing = true;
    globalMetadataRefreshState.process = proc;
    globalMetadataRefreshState.startTime = Date.now();

    proc.stdout.on('data', (d) => {
      const out = d.toString().trim();
      if (out) console.log('🌍 Global Metadata Refresh:', out);
    });
    proc.stderr.on('data', (d) => {
      const out = d.toString().trim();
      if (out) console.error('⚠️  Global Metadata Refresh stderr:', out);
    });
    proc.on('close', (code) => {
      console.log(`✅ Global metadata refresh exited with code ${code}`);
      globalMetadataRefreshState.isRefreshing = false;
      globalMetadataRefreshState.process = null;
    });
    proc.on('error', (err) => {
      console.error('❌ Global metadata refresh error:', err);
      globalMetadataRefreshState.isRefreshing = false;
      globalMetadataRefreshState.process = null;
    });

    return NextResponse.json({ success: true, message: 'Global metadata refresh started for all artists.' });
  } catch (error) {
    globalMetadataRefreshState.isRefreshing = false;
    globalMetadataRefreshState.process = null;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return NextResponse.json({
    isRefreshing: globalMetadataRefreshState.isRefreshing,
    startTime: globalMetadataRefreshState.startTime || null,
  });
}

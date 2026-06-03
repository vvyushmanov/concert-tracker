import { spawn } from 'child_process';

/**
 * Fire-and-forget metadata enrichment (MBID via MusicBrainz + image via Fanart.tv)
 * by spawning scripts/fetch_metadata.py detached. Used to auto-enrich newly added
 * artists so they don't sit in the DB without an MBID/image.
 *
 * Server-only (uses child_process) — import from route handlers only.
 */
function fireAndForget(args: string[]) {
  try {
    const proc = spawn(
      'python3',
      ['-u', '/app/scripts/fetch_metadata.py', ...args, '--no-color-log'],
      { cwd: '/app/scripts', detached: true, stdio: 'ignore' }
    );
    proc.on('error', (e) => console.error('metadata job failed to start:', e));
    proc.unref();
  } catch (e) {
    console.error('metadata job spawn error:', e);
  }
}

/** Enrich a single newly-added artist (MBID + image). */
export function enrichArtistMetadata(artistId: number) {
  fireAndForget(['--artist-id', String(artistId)]);
}

/** Enrich all of a user's followed artists (used after a Last.fm sync adds many). */
export function enrichUserMetadata(userId: number) {
  fireAndForget(['--user-id', String(userId)]);
}

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { createHash, timingSafeEqual } from 'crypto';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ingestState } from './state';

export const dynamic = 'force-dynamic';
// First-run new-city geocoding is the slow path; give the subprocess room.
export const maxDuration = 600;

const SCRIPTS_DIR = '/app/scripts';

/**
 * Constant-time bearer comparison over SHA-256 digests. Hashing first makes the
 * two buffers equal-length (timingSafeEqual throws on length mismatch) and hides
 * the token length. This endpoint is for the headless scraper agent — a shared
 * secret, deliberately NOT NextAuth.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Run ingest_json.py on a temp file and resolve its parsed INGEST_RESULT. */
function runIngest(inputPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'python3',
      ['-u', `${SCRIPTS_DIR}/ingest_json.py`, '--input-json', inputPath],
      { cwd: SCRIPTS_DIR }
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ingest_json.py exited ${code}: ${stderr.slice(-800)}`));
      }
      const line = stdout.split('\n').find((l) => l.startsWith('INGEST_RESULT '));
      if (!line) {
        return reject(new Error('ingest_json.py produced no INGEST_RESULT line'));
      }
      try {
        resolve(JSON.parse(line.slice('INGEST_RESULT '.length)));
      } catch {
        reject(new Error('ingest_json.py INGEST_RESULT line was not valid JSON'));
      }
    });
  });
}

/**
 * Fire-and-forget global metadata enrichment (MBID repair + images) after a
 * successful ingest. No --user-id: per-user playcounts come from the Last.fm
 * sync, and relevance is computed at read time now.
 */
function spawnMetadataRefresh(): void {
  try {
    const proc = spawn('python3', ['-u', `${SCRIPTS_DIR}/fetch_metadata.py`], {
      cwd: SCRIPTS_DIR,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
  } catch (e) {
    console.error('Failed to spawn fetch_metadata.py after ingest:', e);
  }
}

export async function POST(request: Request) {
  // 1. Endpoint must be configured — fail closed if no token is set.
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'Ingest endpoint not configured (INGEST_TOKEN unset)' },
      { status: 503 }
    );
  }

  // 2. Bearer-token auth (constant-time).
  const header = request.headers.get('authorization') || '';
  const m = header.match(/^Bearer (.+)$/);
  if (!m || !tokenMatches(m[1], expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3. Single-flight. Claim synchronously (no await between the check and the
  //    set) so two concurrent requests can never both pass. A claim older than
  //    maxDuration is presumed dead (handler killed mid-ingest) and may be
  //    reclaimed — otherwise a crash would 409 the endpoint forever.
  const STALE_MS = maxDuration * 1000;
  const claimIsStale =
    ingestState.running &&
    ingestState.startedAt !== null &&
    Date.now() - ingestState.startedAt > STALE_MS;
  if (ingestState.running && !claimIsStale) {
    return NextResponse.json({ error: 'An ingest is already running' }, { status: 409 });
  }
  ingestState.running = true;
  ingestState.startedAt = Date.now();

  let inputPath: string | null = null;
  try {
    // 4. Body must be a JSON array of concerts.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
    }
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Body must be a JSON array of concerts' },
        { status: 400 }
      );
    }

    // 5. Hand the payload to ingest_json.py via a temp file.
    inputPath = join(tmpdir(), `ingest-${ingestState.startedAt}-${process.pid}.json`);
    await writeFile(inputPath, JSON.stringify(body), 'utf-8');

    const result = await runIngest(inputPath);

    // 6. Kick off background metadata enrichment (non-blocking) — only when the
    //    ingest actually added concerts, so no-op pushes don't pile up scans.
    if (typeof result.new === 'number' && result.new > 0) {
      spawnMetadataRefresh();
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Ingest failed:', message);
    return NextResponse.json({ error: 'Ingest failed', detail: message }, { status: 500 });
  } finally {
    ingestState.running = false;
    ingestState.startedAt = null;
    if (inputPath) {
      await unlink(inputPath).catch(() => {});
    }
  }
}

/**
 * Ingest queue worker — drains the durable IngestBatch queue serially.
 *
 * The scraper agent POSTs one batch per scraped page to /api/ingest, which
 * enqueues an IngestBatch row (PENDING) and returns 202 immediately. This worker
 * runs INSIDE the Next.js process and processes batches at its own pace:
 *
 *   claim PENDING (atomic) → ingest_json.py on its payload → DONE (+stats)
 *                          ↘ on failure: attempts++ → PENDING (retry) | ERROR
 *
 * Why in-process (not a separate service): one home agent, ~250 idempotent msgs/
 * day, single backend — a DB-backed queue + in-process worker is the right-sized
 * best practice (durable across restart, retries, dead-letter, status) with zero
 * new infrastructure. Writes are serial (one batch at a time) which also avoids
 * the concurrent city-creation races in the Python writer.
 *
 * HMR-safe: all mutable state lives on globalThis, so Next.js dev module reloads
 * never spawn a second drain loop (same trick as ./state.ts and lib/prisma.ts).
 */
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

const SCRIPTS_DIR = '/app/scripts';
const MAX_ATTEMPTS = 4; // batch → ERROR (dead-letter) after this many failed tries
const STALE_MS = 10 * 60 * 1000; // a PROCESSING row older than this is presumed orphaned (crash) and reclaimed
const SAFETY_INTERVAL_MS = 60 * 1000; // periodic kick: catches retries + batches enqueued while the worker was idle
const METADATA_DEBOUNCE_MS = 20 * 1000; // run fetch_metadata.py once, this long after the queue settles

interface WorkerState {
  draining: boolean;
  newSinceMeta: boolean; // a batch added new concerts since the last metadata run → schedule one
  metaTimer: NodeJS.Timeout | null;
  interval: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __ingestWorker?: WorkerState };
const state: WorkerState =
  g.__ingestWorker ??
  (g.__ingestWorker = { draining: false, newSinceMeta: false, metaTimer: null, interval: null });

const nowSec = () => Math.floor(Date.now() / 1000);

/** Run ingest_json.py on a JSON file and resolve its parsed INGEST_RESULT line. */
function runIngest(inputPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-u', `${SCRIPTS_DIR}/ingest_json.py`, '--input-json', inputPath], {
      cwd: SCRIPTS_DIR,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ingest_json.py exited ${code}: ${stderr.slice(-800)}`));
      const line = stdout.split('\n').find((l) => l.startsWith('INGEST_RESULT '));
      if (!line) return reject(new Error('ingest_json.py produced no INGEST_RESULT line'));
      try {
        resolve(JSON.parse(line.slice('INGEST_RESULT '.length)));
      } catch {
        reject(new Error('ingest_json.py INGEST_RESULT line was not valid JSON'));
      }
    });
  });
}

/** Fire-and-forget global metadata enrichment (MBID repair + images). */
function spawnMetadataRefresh(): void {
  try {
    const proc = spawn('python3', ['-u', `${SCRIPTS_DIR}/fetch_metadata.py`], {
      cwd: SCRIPTS_DIR,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    console.log('[ingest-worker] queue drained — spawned fetch_metadata.py');
  } catch (e) {
    console.error('[ingest-worker] failed to spawn fetch_metadata.py:', e);
  }
}

/** Reclaim PROCESSING rows orphaned by a crash/restart so they get retried. */
async function recoverStale(): Promise<void> {
  const cutoff = nowSec() - Math.floor(STALE_MS / 1000);
  const { count } = await prisma.ingestBatch.updateMany({
    where: { status: 'PROCESSING', startedAt: { lt: cutoff } },
    data: { status: 'PENDING' },
  });
  if (count > 0) console.log(`[ingest-worker] reclaimed ${count} stale PROCESSING batch(es)`);
}

/**
 * Atomically claim the oldest PENDING batch not deferred this drain. The
 * updateMany guard (status still PENDING) makes the claim race-safe even if a
 * second drain ever ran. Returns the claimed row or null when none remain.
 */
async function claimNext(deferred: Set<number>): Promise<{ id: number; payload: string; attempts: number } | null> {
  const where = deferred.size > 0
    ? { status: 'PENDING' as const, id: { notIn: [...deferred] } }
    : { status: 'PENDING' as const };
  const cand = await prisma.ingestBatch.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!cand) return null;
  const claim = await prisma.ingestBatch.updateMany({
    where: { id: cand.id, status: 'PENDING' },
    data: { status: 'PROCESSING', startedAt: nowSec() },
  });
  if (claim.count !== 1) return claimNext(deferred); // lost the race — try the next one
  return prisma.ingestBatch.findUnique({ where: { id: cand.id }, select: { id: true, payload: true, attempts: true } });
}

async function processBatch(batch: { id: number; payload: string; attempts: number }, deferred: Set<number>): Promise<void> {
  const inputPath = join(tmpdir(), `ingest-batch-${batch.id}-${process.pid}.json`);
  try {
    await writeFile(inputPath, batch.payload, 'utf-8'); // payload is already a JSON array string
    const result = await runIngest(inputPath);
    await prisma.ingestBatch.update({
      where: { id: batch.id },
      data: { status: 'DONE', result: JSON.stringify(result), finishedAt: nowSec(), error: null },
    });
    if (typeof result.new === 'number' && result.new > 0) state.newSinceMeta = true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = batch.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await prisma.ingestBatch.update({
      where: { id: batch.id },
      data: {
        status: dead ? 'ERROR' : 'PENDING',
        attempts,
        error: message.slice(0, 1000),
        startedAt: null,
        finishedAt: dead ? nowSec() : null,
      },
    });
    if (!dead) deferred.add(batch.id); // retry on a later drain, not in a hot loop
    console.error(`[ingest-worker] batch ${batch.id} failed (attempt ${attempts}/${MAX_ATTEMPTS})${dead ? ' → ERROR' : ' → will retry'}: ${message}`);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

/** Run fetch_metadata.py once, METADATA_DEBOUNCE_MS after the queue last settled with new concerts. */
function scheduleMetadata(): void {
  if (!state.newSinceMeta) return;
  if (state.metaTimer) clearTimeout(state.metaTimer);
  state.metaTimer = setTimeout(async () => {
    state.metaTimer = null;
    // Only run if the queue is genuinely idle (nothing PENDING/PROCESSING).
    const busy = await prisma.ingestBatch.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } });
    if (busy > 0) { kickWorker(); return; } // more arrived — let the drain reschedule us
    state.newSinceMeta = false;
    spawnMetadataRefresh();
  }, METADATA_DEBOUNCE_MS);
}

/** Drain the queue to empty, then (debounced) trigger metadata. Idempotent: a second call no-ops while draining. */
async function drainLoop(): Promise<void> {
  if (state.draining) return;
  state.draining = true;
  try {
    await recoverStale();
    const deferred = new Set<number>();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await claimNext(deferred);
      if (!batch) break;
      await processBatch(batch, deferred);
    }
    scheduleMetadata();
  } catch (e) {
    console.error('[ingest-worker] drain loop error:', e);
  } finally {
    state.draining = false;
  }
}

/** Kick the worker (event-driven, called by the route after enqueue). Non-blocking. */
export function kickWorker(): void {
  drainLoop().catch((e) => console.error('[ingest-worker] kick failed:', e));
}

/** Boot hook (from instrumentation.ts): reclaim stale work, drain once, and arm a safety interval. */
export function startWorker(): void {
  if (state.interval) return; // already armed (survives HMR)
  state.interval = setInterval(() => kickWorker(), SAFETY_INTERVAL_MS);
  if (typeof state.interval.unref === 'function') state.interval.unref();
  kickWorker();
  console.log('[ingest-worker] started (safety interval armed)');
}

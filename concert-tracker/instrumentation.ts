/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * Boots the ingest queue worker so that, after a backend restart, any batches
 * that were left PENDING (or orphaned mid-PROCESSING by the crash) are recovered
 * and drained without waiting for the next POST. Node runtime only.
 * See app/api/ingest/worker.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('@/app/api/ingest/worker');
    startWorker();
  }
}

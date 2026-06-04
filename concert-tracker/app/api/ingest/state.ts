/**
 * Single-flight guard for POST /api/ingest.
 *
 * Only one ingest runs at a time: the scraper agent pushes serially and
 * ingest_json.py shares the same ConcertDatabaseWriter / DB. Stored on
 * globalThis so the flag survives Next.js dev HMR module reloads (same trick
 * as lib/prisma.ts).
 */
interface IngestState {
  running: boolean;
  startedAt: number | null;
}

const g = globalThis as unknown as { __ingestState?: IngestState };

export const ingestState: IngestState =
  g.__ingestState ?? (g.__ingestState = { running: false, startedAt: null });

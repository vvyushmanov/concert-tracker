import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { bearerOk } from './auth';
import { kickWorker } from './worker';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ingest — async delivery entry point for the desktop scraper agent.
 *
 * The agent pushes ONE batch per scraped page. We durably ENQUEUE it (an
 * IngestBatch row) and return 202 immediately; an in-process worker (./worker.ts)
 * drains the queue serially via ingest_json.py at its own pace. This replaces the
 * old synchronous model (one giant POST that ran the writer inside the request).
 *
 * Idempotent: a batch carries a client `batchId`; re-POSTing the same id (e.g. an
 * agent retry after a network blip) is a no-op — we never double-enqueue. (The
 * Python writer is also idempotent by unique eventUrl, so duplicates are safe
 * even if a batchId ever collides across runs.)
 *
 * Body — either the envelope:
 *   { "batchId": "<run>-fr-p1", "concerts": [ ... ], "source": "fr p1" }
 * or a bare JSON array of concerts (back-compat; a batchId is generated).
 */
export async function POST(request: Request) {
  // 1. Auth — fail closed if unconfigured (503), reject a bad token (401).
  const auth = bearerOk(request);
  if (auth === 'unconfigured') {
    return NextResponse.json(
      { error: 'Ingest endpoint not configured (INGEST_TOKEN unset)' },
      { status: 503 }
    );
  }
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body — accept an envelope {batchId, concerts, source} or a bare array.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }

  let concerts: unknown;
  let batchId: string | undefined;
  let source: string | undefined;
  if (Array.isArray(body)) {
    concerts = body;
  } else if (body && typeof body === 'object') {
    const env = body as Record<string, unknown>;
    concerts = env.concerts;
    if (typeof env.batchId === 'string') batchId = env.batchId;
    if (typeof env.source === 'string') source = env.source;
  }

  if (!Array.isArray(concerts)) {
    return NextResponse.json(
      { error: 'Body must be a JSON array of concerts, or {batchId, concerts:[...]}' },
      { status: 400 }
    );
  }
  if (!batchId) batchId = `auto-${Date.now()}-${randomUUID()}`; // bare-array / non-agent callers

  // 3. Durable, idempotent enqueue. An existing batchId is left untouched (re-POST
  //    is a no-op) — we report its current status rather than re-running it.
  try {
    const createdAt = Math.floor(Date.now() / 1000);
    const row = await prisma.ingestBatch.upsert({
      where: { batchId },
      create: {
        batchId,
        status: 'PENDING',
        received: concerts.length,
        source: source ?? null,
        payload: JSON.stringify(concerts),
        createdAt,
      },
      update: {}, // already enqueued — do not duplicate or reset it
      select: { batchId: true, status: true, received: true },
    });

    // 4. Nudge the worker (non-blocking); it drains PENDING rows at its own pace.
    kickWorker();

    return NextResponse.json(
      { accepted: true, batchId: row.batchId, status: row.status, received: row.received },
      { status: 202 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Ingest enqueue failed:', message);
    return NextResponse.json({ error: 'Enqueue failed', detail: message }, { status: 500 });
  }
}

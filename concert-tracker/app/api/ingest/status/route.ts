import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { bearerOk } from '../auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ingest/status — observability for the async ingest queue.
 *
 * Returns batch counts by status, the in-flight depth, the last successful
 * drain, and recent dead-lettered (ERROR) batches. The scraper agent's dashboard
 * polls this to show backend progress ("queued 4 · ingested 220") now that a
 * POST only enqueues (202) and the worker processes asynchronously.
 */
export async function GET(request: Request) {
  const auth = bearerOk(request);
  if (auth === 'unconfigured') {
    return NextResponse.json({ error: 'Ingest endpoint not configured (INGEST_TOKEN unset)' }, { status: 503 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const grouped = await prisma.ingestBatch.groupBy({ by: ['status'], _count: { _all: true } });
    const counts = { PENDING: 0, PROCESSING: 0, DONE: 0, ERROR: 0 } as Record<string, number>;
    for (const g of grouped) counts[g.status] = g._count._all;

    const lastDone = await prisma.ingestBatch.findFirst({
      where: { status: 'DONE' },
      orderBy: { finishedAt: 'desc' },
      select: { source: true, finishedAt: true, result: true },
    });
    const recentErrors = await prisma.ingestBatch.findMany({
      where: { status: 'ERROR' },
      orderBy: { finishedAt: 'desc' },
      take: 5,
      select: { batchId: true, source: true, attempts: true, error: true, finishedAt: true },
    });

    return NextResponse.json({
      counts,
      inFlight: counts.PENDING + counts.PROCESSING,
      lastDone,
      recentErrors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'Status query failed', detail: message }, { status: 500 });
  }
}

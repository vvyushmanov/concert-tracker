/*
 * ingestClient.js — push scraped concerts to the backend's POST /api/ingest.
 *
 * Async delivery: the agent pushes ONE batch per scraped page (pushBatch) with a
 * client batchId; the endpoint durably ENQUEUES it and returns 202 immediately,
 * and a backend worker drains the queue. So a push is now a fast enqueue, not a
 * minutes-long synchronous write — short timeout, with retries on transient
 * failure. Idempotent: re-sending the same batchId is a no-op server-side.
 *
 * Outbound only: the agent never listens. Uses the global fetch in Electron's
 * Node runtime (Node 18+). Pure (no Electron import) so it can be unit-tested
 * against the live route from plain node.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST a JSON body to the ingest URL with a Bearer token. Returns {status, json}. */
async function postJson(body, opts) {
  const { url, token } = opts || {};
  const timeoutMs = (opts && opts.timeoutMs) || 30000; // enqueue is fast; no long synchronous write

  if (!url) throw new Error('ingestUrl not configured');
  if (!token) throw new Error('ingestToken not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { status: res.status, json };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`ingest timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enqueue one batch of concerts (a scraped page). Retries on transient failures
 * (network error, 5xx, 429); a 4xx (bad token/body) fails fast. A 202/200 means
 * accepted — including an idempotent duplicate of a batchId already queued/done.
 *
 * @param {Array<object>} concerts
 * @param {{url:string, token:string, batchId?:string, source?:string, timeoutMs?:number, maxRetries?:number}} opts
 * @returns {Promise<object>} backend JSON ({accepted, batchId, status, received})
 */
async function pushBatch(concerts, opts) {
  const { url, token, batchId, source } = opts || {};
  if (!url) throw new Error('ingestUrl not configured');
  if (!token) throw new Error('ingestToken not configured');
  if (!Array.isArray(concerts)) throw new Error('concerts must be an array');
  const maxRetries = (opts && opts.maxRetries != null) ? opts.maxRetries : 3;
  const body = { batchId, source, concerts };

  let attempt = 0;
  let lastErr;
  while (attempt <= maxRetries) {
    try {
      const { status, json } = await postJson(body, opts);
      if (status === 202 || status === 200) return json; // accepted (or idempotent dup)
      if (status >= 400 && status < 500 && status !== 429) {
        const detail = json && (json.error || json.detail) ? `${json.error || ''} ${json.detail || ''}`.trim() : '';
        const err = new Error(`ingest rejected: HTTP ${status}${detail ? ' — ' + detail : ''}`);
        err.status = status;
        throw err; // client error — do not retry
      }
      lastErr = new Error(`ingest transient HTTP ${status}`); // 5xx / 429 — retry
    } catch (e) {
      if (e && e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e; // non-retryable
      lastErr = e;
    }
    attempt += 1;
    if (attempt <= maxRetries) await wait(500 * attempt); // linear backoff: 0.5s, 1s, 1.5s
  }
  throw lastErr || new Error('pushBatch failed');
}

/**
 * Back-compat: push a bare array of concerts as a single batch (the server
 * assigns a batchId). Kept for non-agent callers / smoke tests.
 */
function postConcerts(concerts, opts) {
  return pushBatch(concerts, opts);
}

module.exports = { pushBatch, postConcerts };

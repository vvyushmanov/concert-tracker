/*
 * ingestClient.js — push scraped concerts to the backend's POST /api/ingest.
 *
 * Outbound only: the agent never listens. Uses the global fetch in Electron's
 * Node runtime (Node 18+). Pure (no Electron import) so it can be unit-tested
 * against the live route from plain node.
 */

/**
 * POST an array of concert objects to the ingest endpoint with a Bearer token.
 * @param {Array<object>} concerts
 * @param {{url:string, token:string, timeoutMs?:number}} opts
 * @returns {Promise<object>} parsed backend stats ({received, before, after, new, ...})
 * @throws if url/token missing, the request fails, or the backend returns non-2xx
 */
async function postConcerts(concerts, opts) {
  const { url, token } = opts || {};
  const timeoutMs = (opts && opts.timeoutMs) || 600000; // match server maxDuration

  if (!url) throw new Error('ingestUrl not configured');
  if (!token) throw new Error('ingestToken not configured');
  if (!Array.isArray(concerts)) throw new Error('concerts must be an array');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(concerts),
      signal: controller.signal,
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }

    if (!res.ok) {
      const detail = json && (json.error || json.detail) ? `${json.error || ''} ${json.detail || ''}`.trim() : text.slice(0, 200);
      const err = new Error(`ingest failed: HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`ingest timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { postConcerts };

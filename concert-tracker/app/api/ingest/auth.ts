import { createHash, timingSafeEqual } from 'crypto';

/**
 * Shared bearer-token check for the ingest endpoints (POST /api/ingest and
 * GET /api/ingest/status). Constant-time compare over SHA-256 digests so the
 * two buffers are equal-length (timingSafeEqual throws otherwise) and the token
 * length is hidden. This is the headless scraper agent's shared secret — NOT
 * NextAuth.
 *
 * Returns 'unconfigured' when INGEST_TOKEN is unset (fail closed → 503),
 * true on a valid token, false otherwise (→ 401).
 */
export function bearerOk(request: Request): boolean | 'unconfigured' {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return 'unconfigured';
  const header = request.headers.get('authorization') || '';
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return false;
  const a = createHash('sha256').update(m[1]).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

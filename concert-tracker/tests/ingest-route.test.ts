/**
 * Ingest test — POST /api/ingest + GET /api/ingest/status contract (auth,
 * validation, durable idempotent enqueue, worker drain).
 *
 * Runs INSIDE the web container (where the Next.js server listens on :3000 and
 * INGEST_TOKEN is in the process env). Uses fetch (no curl in the container) and
 * reads the token from env so no secret is hardcoded here.
 *
 *   docker compose -f docker-compose.dev.yml exec -T web npx tsx tests/ingest-route.test.ts
 *
 * Covers:
 *   - 503 is NOT expected here (token is configured); we assert the configured path.
 *   - 401 on missing Authorization and on a wrong Bearer token (constant-time).
 *   - 400 on a non-array body and on invalid JSON.
 *   - 202 enqueue on an empty array (the worker runs the real subprocess; no concert rows).
 *   - batchId idempotency: re-POSTing the same id is a no-op that reports the stored row,
 *     and polling it that way shows the worker draining it to DONE.
 *   - concurrent posts both enqueue (202) — there is no single-flight 409 any more.
 *   - GET /api/ingest/status: 401 without a token, counts with one.
 * Leaves a few empty IngestBatch rows (`test-ingest-route-*`); the worker's DONE
 * retention prunes them after 30 days.
 */
const INGEST_URL = 'http://localhost:3000/api/ingest';
const TOKEN = process.env.INGEST_TOKEN;

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function getStatus(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${INGEST_URL}/status`, { headers });
}

function post(opts: { token?: string | null; body?: string; json?: unknown }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const body = opts.body !== undefined ? opts.body : JSON.stringify(opts.json ?? []);
  return fetch(INGEST_URL, { method: 'POST', headers, body });
}

async function waitForServer() {
  // Dev server may still be (re)starting + route compiles lazily on first hit.
  for (let i = 0; i < 90; i++) {
    try {
      // Unauthenticated POST — any HTTP response means the route is serving.
      const r = await fetch(INGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
      if (r.status > 0) return;
    } catch {
      // connection refused — server not up yet
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('server did not become ready within 90s');
}

async function main() {
  if (!TOKEN) {
    console.error('  ❌ INGEST_TOKEN not in env — cannot run route auth tests');
    process.exit(1);
  }
  await waitForServer();

  console.log('\n— auth —');
  const noAuth = await post({ json: [] });
  check(noAuth.status === 401, `missing Authorization → 401 (got ${noAuth.status})`);

  const badAuth = await post({ token: 'definitely-not-the-token', json: [] });
  check(badAuth.status === 401, `wrong Bearer token → 401 (got ${badAuth.status})`);

  // A token of different length than the real one — exercises the SHA-256
  // equal-length path (timingSafeEqual would throw on raw unequal-length bufs).
  const shortAuth = await post({ token: 'x', json: [] });
  check(shortAuth.status === 401, `short wrong token → 401, not a crash (got ${shortAuth.status})`);

  console.log('\n— body validation (authed) —');
  const notArray = await post({ token: TOKEN, json: { not: 'an array' } });
  check(notArray.status === 400, `non-array body → 400 (got ${notArray.status})`);

  const badJson = await post({ token: TOKEN, body: 'this is not json' });
  check(badJson.status === 400, `invalid JSON → 400 (got ${badJson.status})`);

  console.log('\n— enqueue: empty array (bare-array back-compat) —');
  const okRes = await post({ token: TOKEN, json: [] });
  check(okRes.status === 202, `valid empty array → 202 (got ${okRes.status})`);
  const okBody: any = await okRes.json().catch(() => null);
  check(okBody?.accepted === true, 'response.accepted === true');
  check(okBody?.received === 0, `received === 0 for empty array (got ${okBody?.received})`);
  check(
    typeof okBody?.batchId === 'string' && okBody.batchId.startsWith('auto-'),
    `bare array gets a generated batchId (got ${okBody?.batchId})`
  );

  console.log('\n— idempotency + worker drain: envelope with a batchId —');
  const batchId = `test-ingest-route-${Date.now()}`;
  const first = await post({ token: TOKEN, json: { batchId, source: 'ingest-route test', concerts: [] } });
  const firstBody: any = await first.json().catch(() => null);
  check(first.status === 202 && firstBody?.batchId === batchId, `envelope → 202 with our batchId (got ${first.status})`);
  // Same id, different payload: must not re-enqueue or overwrite the stored row
  const again = await post({ token: TOKEN, json: { batchId, concerts: [{ bogus: true }] } });
  const againBody: any = await again.json().catch(() => null);
  check(again.status === 202 && againBody?.received === 0,
    `re-POST of same batchId is a no-op (received stays 0, got ${againBody?.received})`);
  let finalStatus = againBody?.status;
  for (let i = 0; i < 60 && finalStatus !== 'DONE' && finalStatus !== 'ERROR'; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const poll: any = await (await post({ token: TOKEN, json: { batchId, concerts: [] } })).json();
    finalStatus = poll?.status;
  }
  check(finalStatus === 'DONE', `worker drains the batch to DONE (got ${finalStatus})`);

  console.log('\n— concurrency: two simultaneous posts —');
  const [r1, r2] = await Promise.all([post({ token: TOKEN, json: [] }), post({ token: TOKEN, json: [] })]);
  check(r1.status === 202 && r2.status === 202, `both enqueue → [202, 202] (got [${r1.status}, ${r2.status}])`);
  await Promise.all([r1.text(), r2.text()]);

  console.log('\n— status endpoint —');
  const stNoAuth = await getStatus();
  check(stNoAuth.status === 401, `status without token → 401 (got ${stNoAuth.status})`);
  await stNoAuth.text();
  const st = await getStatus(TOKEN);
  const stBody: any = await st.json().catch(() => null);
  check(
    st.status === 200 && ['PENDING', 'PROCESSING', 'DONE', 'ERROR'].every((k) => typeof stBody?.counts?.[k] === 'number'),
    `status → 200 with counts per state (got ${st.status})`
  );

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

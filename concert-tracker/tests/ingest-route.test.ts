/**
 * M2.2 test — POST /api/ingest contract (auth + single-flight + spawn pipeline).
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
 *   - 200 + parsed INGEST_RESULT stats on an empty array (real subprocess, no DB mutation).
 *   - 409 single-flight: two concurrent valid posts → exactly one 200 and one 409.
 */
const URL = 'http://localhost:3000/api/ingest';
const TOKEN = process.env.INGEST_TOKEN;

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function post(opts: { token?: string | null; body?: string; json?: unknown }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const body = opts.body !== undefined ? opts.body : JSON.stringify(opts.json ?? []);
  return fetch(URL, { method: 'POST', headers, body });
}

async function waitForServer() {
  // Dev server may still be (re)starting + route compiles lazily on first hit.
  for (let i = 0; i < 90; i++) {
    try {
      // Unauthenticated POST — any HTTP response means the route is serving.
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
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

  console.log('\n— happy path: empty array (real subprocess, no DB mutation) —');
  const okRes = await post({ token: TOKEN, json: [] });
  check(okRes.status === 200, `valid empty array → 200 (got ${okRes.status})`);
  const okBody: any = await okRes.json().catch(() => null);
  check(okBody?.success === true, 'response.success === true');
  check(okBody?.received === 0, `received === 0 for empty array (got ${okBody?.received})`);
  check(
    typeof okBody?.before === 'number' && typeof okBody?.after === 'number' && typeof okBody?.new === 'number',
    'response carries parsed INGEST_RESULT stats (before/after/new)'
  );
  check(okBody?.new === 0, `new === 0 for empty array (got ${okBody?.new})`);

  console.log('\n— single-flight: two concurrent valid posts —');
  const [r1, r2] = await Promise.all([post({ token: TOKEN, json: [] }), post({ token: TOKEN, json: [] })]);
  const statuses = [r1.status, r2.status].sort();
  check(
    statuses[0] === 200 && statuses[1] === 409,
    `exactly one 200 and one 409 (got [${statuses.join(', ')}])`
  );
  // drain bodies
  await Promise.all([r1.text(), r2.text()]);

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

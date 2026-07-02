/*
 * Django <-> Nest cross-verification matrix (Phase 1A). Proves dual-run: a
 * session started on one backend is honored by the other (shared JWT key +
 * cookie names). Node >= 18.
 * Usage:
 *   DJANGO_URL=http://localhost:8000 NEST_URL=http://localhost:8001 \
 *     EMAIL=u@x.test PASSWORD=pw node scripts/verify/cross-verify.mjs
 */
const DJANGO = (process.env.DJANGO_URL || 'http://localhost:8000').replace(/\/$/, '');
const NEST = (process.env.NEST_URL || 'http://localhost:8001').replace(/\/$/, '');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set EMAIL and PASSWORD env vars.');
  process.exit(2);
}

const cookieOf = (res) => {
  const many = res.headers.getSetCookie?.() ?? [];
  const one = res.headers.get('set-cookie');
  return (many.length ? many : one ? [one] : []).map((c) => c.split(';')[0]).join('; ');
};
const login = (base) =>
  fetch(`${base}/api/v1/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
const me = (base, cookie) => fetch(`${base}/api/v1/auth/me/`, { headers: { Cookie: cookie } });
const refresh = (base, cookie) => fetch(`${base}/api/v1/auth/refresh/`, { method: 'POST', headers: { Cookie: cookie } });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function run() {
  // 1. Django login -> Nest /me
  {
    const cookie = cookieOf(await login(DJANGO));
    const r = await me(NEST, cookie);
    const body = await r.json().catch(() => ({}));
    record('Django login → Nest /me', r.status === 200 && body?.user?.email === EMAIL, `status=${r.status}`);
  }
  // 2. Nest login -> Django /me
  {
    const cookie = cookieOf(await login(NEST));
    const r = await me(DJANGO, cookie);
    record('Nest login → Django /me', r.status === 200, `status=${r.status}`);
  }
  // 3. Django login -> Nest refresh -> Nest /me (with rotated cookie)
  {
    const cookie = cookieOf(await login(DJANGO));
    const rr = await refresh(NEST, cookie);
    const rotated = cookieOf(rr) || cookie;
    const r = await me(NEST, rotated);
    record('Django login → Nest refresh → Nest /me', rr.status === 200 && r.status === 200, `refresh=${rr.status} me=${r.status}`);
  }
  // 4. Nest login -> Django refresh -> Django /me
  {
    const cookie = cookieOf(await login(NEST));
    const rr = await refresh(DJANGO, cookie);
    const rotated = cookieOf(rr) || cookie;
    const r = await me(DJANGO, rotated);
    record('Nest login → Django refresh → Django /me', rr.status === 200 && r.status === 200, `refresh=${rr.status} me=${r.status}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} cross-checks passed.`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('cross-verify error:', e.message);
  process.exit(1);
});

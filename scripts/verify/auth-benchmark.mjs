/*
 * Auth latency benchmark (Phase 1A). Node >= 18 (global fetch).
 * Usage:
 *   BASE=http://localhost:8000 EMAIL=u@x.test PASSWORD=pw N=50 \
 *     node scripts/verify/auth-benchmark.mjs "NestJS"
 * Prints a markdown table (login / me / refresh / profile) with avg/p50/p95.
 */
const BASE = (process.env.BASE || 'http://localhost:8000').replace(/\/$/, '');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const N = Number(process.env.N || 30);
const LABEL = process.argv[2] || BASE;

if (!EMAIL || !PASSWORD) {
  console.error('Set EMAIL and PASSWORD env vars.');
  process.exit(2);
}

const cookieOf = (res) => {
  const many = res.headers.getSetCookie?.() ?? [];
  const one = res.headers.get('set-cookie');
  return (many.length ? many : one ? [one] : []).map((c) => c.split(';')[0]).join('; ');
};
const timed = async (fn) => {
  const t = process.hrtime.bigint();
  const r = await fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, r };
};
const login = () =>
  fetch(`${BASE}/api/v1/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))];
  return { avg: arr.reduce((a, b) => a + b, 0) / arr.length, p50: p(50), p95: p(95) };
};

async function bench(name, iter) {
  const xs = [];
  for (let i = 0; i < N; i += 1) xs.push((await timed(iter)).ms);
  const { avg, p50, p95 } = stats(xs);
  return `| ${name} | ${avg.toFixed(1)} | ${p50.toFixed(1)} | ${p95.toFixed(1)} |`;
}

const rows = [];
rows.push(await bench('login', async () => { const r = await login(); await r.text(); }));

const warm = await login();
const cookie = cookieOf(warm);
rows.push(await bench('me', async () => { await (await fetch(`${BASE}/api/v1/auth/me/`, { headers: { Cookie: cookie } })).text(); }));
rows.push(await bench('profile (PATCH)', async () => {
  await (await fetch(`${BASE}/api/v1/auth/profile/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'Bench User' }) })).text();
}));
rows.push(await bench('refresh', async () => {
  const fresh = cookieOf(await login()); // untimed: get a fresh rotatable cookie
  await (await fetch(`${BASE}/api/v1/auth/refresh/`, { method: 'POST', headers: { Cookie: fresh } })).text();
}));

console.log(`\n### ${LABEL}  (N=${N}, ${BASE})\n`);
console.log('| Endpoint | avg ms | p50 ms | p95 ms |');
console.log('|---|---|---|---|');
console.log(rows.join('\n'));

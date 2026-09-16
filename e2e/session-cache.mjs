// Shared session cache for the verification suites.
//
// The API throttles /auth/login to 5 per IP per minute (THROTTLE_LOGIN_LIMIT) —
// correct behaviour that the suites were tripping over by re-authenticating for
// every block and every browser context. Cookies are cached on disk, validated
// against /auth/me, and only re-minted when genuinely expired.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:8000/api/v1';

/**
 * `fileURLToPath`, not `.pathname.replace(/^\//, '')`.
 *
 * A URL's pathname is PERCENT-ENCODED. This suite used to live under a path with no
 * spaces, so stripping the leading slash happened to produce something openable; moving it
 * into the repo put it under `D:/Code/Full Stack/...` and the pathname became
 * `D:/Code/Full%20Stack/...` — a path that cannot exist.
 *
 * Both `load()` and `save()` swallow their errors, so nothing complained. The cache simply
 * stopped working, and every script fell back to logging in again against a limiter that
 * allows five per minute. The suite still passed, slower and noisier, which is the worst
 * way for a thing to break.
 */
const FILE = fileURLToPath(new URL('./.sessions.json', import.meta.url));

function load() {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; } catch { return {}; }
}
function save(d) { try { writeFileSync(FILE, JSON.stringify(d, null, 1)); } catch {} }

const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function stillValid(jar) {
  try {
    const r = await fetch(`${API}/auth/me`, { headers: { Cookie: cookieHeader(jar) } });
    return r.status === 200;
  } catch { return false; }
}

async function mint(email, password) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.status === 429) {
      // the window is 60s; wait it out rather than hammering
      await new Promise((res) => setTimeout(res, 12000));
      continue;
    }
    const jar = {};
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    if (!Object.keys(jar).length) throw new Error(`login for ${email} returned ${r.status} with no cookies`);
    return jar;
  }
  throw new Error(`login for ${email} stayed throttled`);
}

/** The seeded accounts do not share a password; callers should not have to know. */
const DEFAULT_PASSWORDS = {
  'admin@strata.local': 'ChangeMe123!',
};
const passwordFor = (email, explicit) =>
  explicit ?? DEFAULT_PASSWORDS[email] ?? 'RolePass123!';

/** Cookies for `email`, reused across suites and runs while they remain valid. */
export async function getSession(email, password) {
  const all = load();
  const cached = all[email];
  if (cached && (await stillValid(cached))) return cached;
  const jar = await mint(email, passwordFor(email, password));
  all[email] = jar;
  save(all);
  return jar;
}

/**
 * A jar minted right now, bypassing the cache, with the cache updated to match.
 *
 * `getSession` returns a cached jar whenever `stillValid` passes — and `stillValid` only
 * calls `/auth/me`, which tests the ACCESS token. The refresh token is never checked.
 *
 * The API rotates refresh tokens and revokes the previous jti on every use, so the first
 * run that triggers a refresh spends the cached refresh cookie while its access cookie
 * remains valid for the rest of its 900s. Later runs then receive a jar that looks fine
 * and whose refresh token is already dead — which showed up once as a session-expiry check
 * passing outright and then failing with `ErrorUnauthorized` on the very next run, with no
 * change to the app in between. That was replay detection working correctly on a token
 * this harness had already used.
 *
 * Any test that deliberately drives the refresh path should take its session from here.
 */
export async function freshSession(email, password) {
  const jar = await mint(email, passwordFor(email, password));
  const all = load();
  all[email] = jar;
  save(all);
  return jar;
}

/** Freshly minted cookies in the browser-context shape. */
export async function freshBrowserCookies(email, password) {
  const jar = await freshSession(email, password);
  return Object.entries(jar).map(([name, value]) => ({
    name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }));
}

/**
 * Which account each jar belongs to, so a stale one can be renewed in place.
 *
 * The access cookie lives 900s. A script that takes its session at the top and then
 * runs for several minutes — api-validation makes ~44 assertions — has its cookie
 * expire mid-run, and every call after that point answers 401. In the whole-suite
 * run that showed up as "4/44 passed, 40 FAILED", every failure reading
 * `401 Unauthorized`, which looks exactly like forty regressions.
 */
const jarOwner = new WeakMap();

/** The same cookies as a Map, matching the shape the suites already use. */
export async function getJar(email, password) {
  const jar = new Map(Object.entries(await getSession(email, password)));
  jarOwner.set(jar, { email, password });
  return jar;
}

/**
 * Re-authenticate a jar that has gone stale, updating it IN PLACE so every caller
 * holding the same Map picks up the new cookies. Returns false when the jar's owner
 * is unknown (a hand-built Map), so callers can fall back to failing honestly.
 */
export async function renewJar(jar) {
  const owner = jarOwner.get(jar);
  if (!owner) return false;
  const all = load();
  delete all[owner.email];
  save(all);
  const fresh = await mint(owner.email, passwordFor(owner.email, owner.password));
  all[owner.email] = fresh;
  save(all);
  jar.clear();
  for (const [k, v] of Object.entries(fresh)) jar.set(k, v);
  return true;
}

/** Cookies in Playwright's addCookies() shape, so a browser context can be
 *  authenticated without driving the login form (and burning the quota). */
export async function getBrowserCookies(email, password) {
  const jar = await getSession(email, password);
  return Object.entries(jar).map(([name, value]) => ({
    name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }));
}

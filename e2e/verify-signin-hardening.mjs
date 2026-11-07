// Three things about signing in that were true only on paper.
//
//  - The sign-in limit was per ADDRESS: five a minute from one IP. Many
//    machines guessing slowly at one account each had a bucket of their own.
//    Failures are counted per account now — per account AND address, so that
//    somebody who knows a colleague's address locks out only themselves, with
//    a ceiling for the account from everywhere together. A new password lifts
//    the pause: "or reset your password" is what it tells people to do.
//
//  - A write was protected from another site's page by the cookie's SameSite
//    setting alone, which is a deployment option. A request that changes
//    something and says where it came from must now have come from one of ours.
//
//  - JWT_REFRESH_SECRET was required and never read: both kinds of token were
//    signed with the access key. Refresh tokens have their own now.
//
//  API only. The lockout part makes eleven sign-in attempts against an address
//  that has no account, and so waits out the per-address limit as it goes.
import { api, adminJar, provision, API } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };

const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const jarOf = (response) => {
  const jar = new Map();
  for (const c of response.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return jar;
};
/** One request with explicit headers — the kit's `api` cannot set an Origin. */
const send = async (method, path, { jar, origin, body, from } = {}) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar?.size) headers.Cookie = cookieHeader(jar);
  if (origin) headers.Origin = origin;
  // The address the API believes, from a proxy on a private address — which is
  // what a local test runner is.
  if (from) headers['X-Real-IP'] = from;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch {}
  return { s: r.status, j, t, jar: jarOf(r) };
};
/**
 * A sign-in attempt that waits out the PER-ADDRESS limit (a throttler 429) and
 * reports everything else, including the per-account pause, as it comes.
 */
const attempt = async (email, password, from) => {
  for (let tries = 0; tries < 12; tries += 1) {
    const r = await send('POST', '/auth/login', { body: { email, password }, from });
    const paused = r.s === 429 && /failed sign-in attempts/i.test(r.t);
    if (r.s !== 429 || paused) return { ...r, paused };
    await new Promise((resolve) => setTimeout(resolve, 13000));
  }
  return { s: 429, t: 'the per-address limit never cleared', paused: false, jar: new Map() };
};
const kind = (token) => {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).token_type; } catch { return null; }
};

const admin = await adminJar();
const p = await provision('signin');

// ---- where a write may come from ------------------------------------------------
console.log('===== a write has to come from one of ours');
{
  const foreign = await send('POST', '/notifications/mark_all_read', { jar: admin, origin: 'https://evil.example' });
  rec(foreign.s === 403 && /OriginNotAllowed/.test(foreign.t),
    'a signed-in write that another site made the browser send is refused', `${foreign.s} ${foreign.t.slice(0, 200)}`);
  const ours = await send('POST', '/notifications/mark_all_read', { jar: admin, origin: 'http://localhost:3000' });
  rec(ours.s < 300, 'the same write from the app itself goes through', `${ours.s} ${ours.t.slice(0, 200)}`);
  const script = await send('POST', '/notifications/mark_all_read', { jar: admin });
  rec(script.s < 300, 'and so does one with no Origin at all — a script, a webhook', `${script.s} ${script.t.slice(0, 200)}`);
  const read = await send('GET', '/auth/me', { jar: admin, origin: 'https://evil.example' });
  rec(read.s === 200, 'reading is CORS\'s business, not this check\'s', `${read.s}`);
  const lookalike = await send('POST', '/notifications/mark_all_read', { jar: admin, origin: 'http://localhost:3000.evil.example' });
  rec(lookalike.s === 403, 'an origin that only starts like ours is not ours', `${lookalike.s}`);
}

// ---- one key per kind of token --------------------------------------------------
console.log('===== a refresh token is its own kind of token');
{
  // A throwaway session: the persistent test account, on a password re-issued for it.
  const EMAIL = 'e2e.recovery@strata.local';
  const invited = await api(admin, 'POST', '/users/invite', {
    workspaceId: p.ws, name: 'E2E Recovery', email: EMAIL, roleName: 'MEMBER',
  });
  const issued = await api(admin, 'POST', `/users/${invited.j?.userId}/temp-password`, { workspaceId: p.ws });
  const password = issued.j?.temporaryPassword;
  if (!password) {
    console.log('   this installation mails temporary passwords, so no session can be made here; skipped');
  } else {
    const session = await attempt(EMAIL, password);
    const tokens = [...session.jar];
    const access = tokens.find(([, v]) => kind(v) === 'access');
    const refresh = tokens.find(([, v]) => kind(v) === 'refresh');
    rec(Boolean(access) && Boolean(refresh), 'signing in issues an access token and a refresh token',
      `${session.s} cookies: ${tokens.map(([k]) => k).join(', ')}`);
    if (access && refresh) {
      // The access token, put where the refresh token goes.
      const swapped = await send('POST', '/auth/refresh', { jar: new Map([[refresh[0], access[1]]]) });
      rec(swapped.s === 401, 'an access token is not accepted as a refresh token', `${swapped.s} ${swapped.t.slice(0, 160)}`);
      // And the other way round: a refresh token is not a session.
      const asAccess = await send('GET', '/auth/me', { jar: new Map([[access[0], refresh[1]]]) });
      rec(asAccess.s === 401, 'nor a refresh token as an access token', `${asAccess.s}`);
      const renewed = await send('POST', '/auth/refresh', { jar: new Map([refresh]) });
      rec(renewed.s === 200 && renewed.jar.size >= 2, 'the real refresh token still renews the session',
        `${renewed.s} ${renewed.t.slice(0, 160)}`);
    }
    // Leave the account as it is kept between runs: on a password nobody has.
    await api(admin, 'POST', `/users/${invited.j?.userId}/temp-password`, { workspaceId: p.ws });
  }
}

// ---- failures counted per account -------------------------------------------------
console.log('===== ten wrong guesses at one account, and it takes no more');
{
  // No such account: failures are counted the same, so the answer cannot be
  // used to learn which addresses have one.
  const target = `e2e.lockout.${Date.now()}@strata.local`;
  const statuses = [];
  for (let i = 0; i < 10; i += 1) statuses.push((await attempt(target, `Wrong-Guess-${i}`)).s);
  rec(statuses.every((s) => s === 400), 'ten wrong guesses are each answered "invalid email or password"',
    JSON.stringify(statuses));
  const eleventh = await attempt(target, 'Wrong-Guess-10');
  rec(eleventh.paused && /minute/.test(eleventh.t),
    'the eleventh is not looked at: the account is paused, and says for how long',
    `${eleventh.s} ${eleventh.t.slice(0, 220)}`);
  const other = await attempt(`e2e.lockout.other.${Date.now()}@strata.local`, 'Wrong-Guess');
  rec(other.s === 400 && !other.paused, 'another account is not paused with it', `${other.s} ${other.t.slice(0, 160)}`);
}

// ---- a colleague cannot lock you out; a new password lets you back in ------------------
console.log('===== a pause is for the address that earned it, and a new password lifts it');
{
  const EMAIL = 'e2e.recovery@strata.local';
  const invited = await api(admin, 'POST', '/users/invite', {
    workspaceId: p.ws, name: 'E2E Recovery', email: EMAIL, roleName: 'MEMBER',
  });
  const userId = invited.j?.userId;
  const issued = await api(admin, 'POST', `/users/${userId}/temp-password`, { workspaceId: p.ws });
  const password = issued.j?.temporaryPassword;
  if (!password) {
    console.log('   this installation mails temporary passwords; skipped');
  } else {
    const ATTACKER = '203.0.113.77';
    const OWNER = '203.0.113.78';
    for (let i = 0; i < 10; i += 1) await attempt(EMAIL, `Wrong-Guess-${i}`, ATTACKER);
    const fromThere = await attempt(EMAIL, password, ATTACKER);
    rec(fromThere.paused, 'ten wrong guesses from one address pause the account there, right password or not',
      `${fromThere.s} ${fromThere.t.slice(0, 160)}`);
    const fromHome = await attempt(EMAIL, password, OWNER);
    rec(fromHome.s === 200, 'but its owner, signing in from somewhere else, is not locked out', `${fromHome.s} ${fromHome.t.slice(0, 160)}`);
    const reissued = await api(admin, 'POST', `/users/${userId}/temp-password`, { workspaceId: p.ws });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const afterReset = await attempt(EMAIL, reissued.j?.temporaryPassword, ATTACKER);
    rec(afterReset.s === 200, 'and a new password lifts the pause, even at the address that earned it',
      `${afterReset.s} ${afterReset.t.slice(0, 160)}`);
    await api(admin, 'POST', `/users/${userId}/temp-password`, { workspaceId: p.ws });
  }
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

// Proof for: mixed-case e-mail lockout, logout not ending the session, the
// webhookSecret leak, and that self-registration stays closed. Accounts are
// created by a workspace manager, so the login checks use a seeded one.
import { api, adminJar, getJar, provision } from './kit.mjs';

const API = 'http://localhost:8000/api/v1';
const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 220)}`); };

function jarFrom(res) {
  const j = new Map();
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
    if (v) j.set(k, v); else j.delete(k);
  }
  return j;
}
const cookieOf = (j) => [...j].map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * The login limiter is 5/min per IP and every probe on this host shares that
 * bucket, so a 429 here says nothing about the behaviour under test. Record it
 * as skipped rather than failing the suite on a collision.
 */
const skipped = [];

/**
 * A login that waits out the limiter instead of giving up on the check.
 * `retry` re-issues the identical request; callers pass a thunk so the response
 * the assertions read is the one that actually got through.
 */
async function loginOrWait(retry, label) {
  let res = await retry();
  if (res.status === 429) {
    console.log(`   ${label}: login limiter hit — waiting out the 60s window`);
    await new Promise((r) => setTimeout(r, 62_000));
    res = await retry();
  }
  return res;
}

function recLogin(res, name) {
  if (res.status === 429) {
    console.log(`SKIP  ${name}  -> login limiter (5/min)`);
    skipped.push(name);
    return false;
  }
  rec(res.status === 200, name, `got ${res.status}`);
  return res.status === 200;
}

// ---- 0. onboarding is closed ------------------------------------------------
console.log('===== self-registration is closed');
{
  // This endpoint used to exist with no screen in front of it: anyone could mint
  // an account, read every workspace's name and queue join requests.
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'closed.probe@qa.local', password: 'GoodPass123!', name: 'Closed Probe' }),
  });
  rec(reg.status === 404, 'POST /auth/register does not exist', `got ${reg.status}`);
}

// ---- 1. a capital letter in the e-mail must not lock the account out -------
console.log('\n===== mixed-case e-mail');
{
  // A seeded account, typed the way a person might type their own address.
  // Addresses are stored lowercased, so this is the string that used to be
  // answered with "invalid email or password".
  const typed = 'Role.Tester@Strata.Local';
  const PASSWORD = 'RolePass123!';
  {

  const asTyped = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed, password: PASSWORD }),
      }),
    'as typed',
  );
  const typedOk = recLogin(asTyped, 'logging in with the SAME string the user typed works');

  const lower = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed.toLowerCase(), password: PASSWORD }),
      }),
    'lowercased',
  );
  recLogin(lower, 'and so does the lowercased form');

  const padded = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `  ${typed}  `, password: PASSWORD }),
      }),
    'padded',
  );
  recLogin(padded, 'a stray leading/trailing space is tolerated too');

  const wrong = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: typed, password: 'WrongPass123!' }),
  });
  rec(wrong.status >= 400, 'a wrong password is still refused — normalisation did not weaken auth', `${wrong.status}`);

  // ---- 2. logout must actually end the session ----------------------------
  console.log('\n===== logout ends the session');
  if (!typedOk) {
    console.log('   no fresh session (login limiter) — skipping the logout checks');
    skipped.push('the five logout-replay checks');
  } else {
  const session = jarFrom(asTyped);
  rec(session.has('strata_refresh'), 'a refresh cookie was issued', [...session.keys()].join(','));
  const stolen = cookieOf(session); // a copy taken BEFORE logout, as an attacker would have

  const me1 = await fetch(`${API}/auth/me`, { headers: { Cookie: stolen } });
  rec(me1.status === 200, 'the session works before logout', String(me1.status));

  const bye = await fetch(`${API}/auth/logout`, { method: 'POST', headers: { Cookie: stolen } });
  rec(bye.status < 400, 'logout succeeds', String(bye.status));

  const replay = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { Cookie: stolen } });
  rec(replay.status === 401, 'REPLAYING the old refresh cookie after logout is refused',
    `expected 401, got ${replay.status} ${(await replay.text()).slice(0, 120)}`);

  const minted = jarFrom(replay);
  rec(!minted.has('strata_access') || !minted.get('strata_access'),
    'no new session is minted from the dead token', [...minted.keys()].join(','));
  }
  }
}

// ---- 2b. the same normalisation on the administrator account ---------------
console.log('\n===== case and whitespace on a seeded account');
{
  const spellings = [
    ['as seeded', 'admin@strata.local'],
    ['ALL CAPS', 'ADMIN@STRATA.LOCAL'],
    ['Mixed Case', 'Admin@Strata.Local'],
    ['padded', '  admin@strata.local  '],
  ];
  for (const [label, email] of spellings) {
    // The limiter is 5/min per IP and every probe on this host shares the
    // bucket, so these four spellings — the whole point of the section — were
    // usually skipped, and the suite total silently shrank from 17 to 8 rather
    // than reporting that the behaviour had not been checked. Waiting out one
    // 60-second window buys back real coverage; skipping bought nothing.
    let r;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      r = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'ChangeMe123!' }),
      });
      if (r.status !== 429 || attempt === 1) break;
      console.log(`   ${label}: login limiter hit — waiting out the 60s window`);
      await new Promise((res) => setTimeout(res, 62_000));
    }
    if (r.status === 429) {
      console.log(`   SKIP ${label} — still limited after waiting a full window`);
      skipped.push(`signing in with the address written ${label}`);
      continue;
    }
    rec(r.status === 200, `signing in with the address written ${label}`, `${r.status}`);
  }
}

// ---- 3. webhookSecret must never come back on the wire --------------------
console.log('\n===== the webhook secret is write-only');
{
  const p = await provision('sec2');
  const created = await api(p.admin, 'POST', '/github_integrations', {
    projectId: p.project, repoOwner: 'acme', repoName: 'widgets',
    accessToken: 'ghp_fake_token', webhookSecret: 's3cr3t-hook', autoUpdateStatus: true,
  });
  rec(created.s === 201 || created.s === 200, 'an integration can be created', `${created.s} ${created.t.slice(0, 140)}`);

  const leakedOnCreate = JSON.stringify(created.j ?? {}).includes('s3cr3t-hook');
  rec(!leakedOnCreate, 'the create response does not echo the secret', created.t.slice(0, 200));

  const listed = await api(p.admin, 'GET', `/github_integrations?projectId=${p.project}`);
  rec(!listed.t.includes('s3cr3t-hook'), 'the list response does not contain the secret', listed.t.slice(0, 200));
  rec(!listed.t.includes('ghp_fake_token'), 'nor the access token', listed.t.slice(0, 160));

  const id = created.j?.id;
  if (id) {
    const one = await api(p.admin, 'GET', `/github_integrations/${id}`);
    rec(!one.t.includes('s3cr3t-hook'), 'nor does retrieve-by-id', one.t.slice(0, 200));
  }
  rec((listed.j?.items ?? []).length >= 1, 'the integration itself is still readable', String((listed.j?.items ?? []).length));
  await p.cleanup();
}

const bad = out.filter(([ok]) => !ok);
// The skip count goes in the tally line. A rate-limited check used to vanish
// from the total instead of showing up, so the suite could report a clean
// 196/196 while nine behaviours here had not been exercised at all.
console.log(
  `\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}` +
    (skipped.length ? `  skipped ${skipped.length}` : ''),
);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
skipped.forEach((n) => console.log('  SKIPPED: ' + n));

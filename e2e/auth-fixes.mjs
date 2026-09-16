// Proof for: mixed-case e-mail lockout, logout not ending the session, and the
// webhookSecret leak. Registration is rate-limited to 3/hour, so this registers
// exactly one account and reuses it.
import { api, adminJar, getJar, provision } from './kit.mjs';
import { readFile, writeFile } from 'node:fs/promises';

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

// ---- 1. a capital letter in the e-mail must not lock the account out -------
console.log('===== mixed-case e-mail');
{
  // Registration is rate limited to 3/hour, so the mixed-case account is
  // registered ONCE and reused on every later run. Without this the suite could
  // only be run three times an hour, and every check below it failed with a 429
  // that had nothing to do with the behaviour being tested.
  const ACCOUNT_FILE = new URL('./.qa-mixedcase-account.json', import.meta.url);
  let typed;
  let registered = false;
  try {
    typed = JSON.parse(await readFile(ACCOUNT_FILE, 'utf8')).email;
  } catch {
    typed = null;
  }

  if (!typed) {
    const suffix = String(process.pid).slice(-4) + Math.floor(process.uptime() * 1000) % 9973;
    typed = `QA.Mixed.${suffix}@QA.Local`;
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: typed, password: 'GoodPass123!', name: 'Mixed Case' }),
    });
    const regBody = await reg.json().catch(() => ({}));
    if (reg.status === 201) {
      registered = true;
      await writeFile(ACCOUNT_FILE, JSON.stringify({ email: typed }));
      rec(true, 'registration with a mixed-case address succeeds', '201');
      console.log(`   typed "${typed}" -> stored "${regBody?.user?.email}"`);
    } else if (reg.status === 429) {
      // Recorded as a SKIP, not as a pass. Counting an unrun check as green is
      // how a suite comes to report a clean total over behaviour nobody tested.
      console.log(`   SKIP registration — rate limited (3/hour) and no cached account yet`);
      skipped.push('registration with a mixed-case address succeeds');
      typed = null;
    } else {
      rec(false, 'registration with a mixed-case address succeeds', `${reg.status} ${JSON.stringify(regBody).slice(0, 160)}`);
      typed = null;
    }
  } else {
    rec(true, 'registration with a mixed-case address succeeds (reusing the account from an earlier run)', typed);
  }

  if (!typed) {
    console.log('   no mixed-case account available — skipping the login/logout checks that need one');
  } else {

  const asTyped = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed, password: 'GoodPass123!' }),
      }),
    'as typed',
  );
  const typedOk = recLogin(asTyped, 'logging in with the SAME string the user typed works');

  const lower = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed.toLowerCase(), password: 'GoodPass123!' }),
      }),
    'lowercased',
  );
  recLogin(lower, 'and so does the lowercased form');

  const padded = await loginOrWait(
    () =>
      fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `  ${typed}  `, password: 'GoodPass123!' }),
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
  void registered;
}

// ---- 2b. the same normalisation, provable without registering -------------
// A seeded account exercises login normalisation with no dependency on the
// 3/hour registration limiter, so this half of the behaviour is always covered.
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

// A self-check on the harness, not on the application.
//
// The access cookie lives 900s. A script that takes its session at the top and then
// runs for minutes has it expire mid-run, and every call after that answers 401. In a
// whole-suite run that surfaced as
//
//     FAIL  api-validation.mjs   4/44
//
// with all forty failures reading `401 Unauthorized` — indistinguishable from forty
// regressions until you read them. api() now re-authenticates once on a 401.
//
// This exists because the failure mode is invisible: if the renewal quietly stops
// working, the suite goes back to reporting other people's bugs as forty of its own.
import { api, adminJar } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 250)}`); };

const jar = await adminJar();

const healthy = await api(jar, 'GET', '/auth/me');
rec(healthy.s === 200, 'a healthy session reads /auth/me', String(healthy.s));

// Simulate expiry the way the server sees it: a syntactically valid cookie that no
// longer authenticates.
const original = jar.get('strata_access');
const corrupted = `expired.${String(original).slice(8)}`;
jar.set('strata_access', corrupted);
rec(jar.get('strata_access') === corrupted, 'the access cookie was corrupted for the test', '');

const recovered = await api(jar, 'GET', '/auth/me');
console.log(`   after corruption api() answered ${recovered.s}`);
rec(recovered.s === 200, 'api() recovers from an expired session', String(recovered.s));
rec(jar.get('strata_access') !== corrupted,
  'and the jar was renewed IN PLACE, so later calls reuse the fresh cookie',
  'the cookie was not replaced');

// The renewal must not paper over a real authentication failure.
const anon = await api(new Map(), 'GET', '/auth/me');
console.log(`   an unauthenticated call answered ${anon.s}`);
rec(anon.s === 401,
  'a genuinely unauthenticated call still reports 401 rather than being retried away',
  String(anon.s));

const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

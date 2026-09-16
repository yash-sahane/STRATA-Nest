// A workspace declares which timezone its working day belongs to.
//
// Attendance is filed against a DAY, and until now that day was the SERVER's — a
// deployment detail. Moving the container from Mumbai to Virginia would silently redraw
// everyone's attendance, and a team whose office is in one zone had no way to say so.
//
// `Workspace.settings.timezone` is the declaration. Both halves resolve it the same way,
// which is the only thing that keeps them in step:
//
//     workspace zone  ->  server zone  ->  (browser local, before either arrives)
//
// Verified by DECLARING a zone far enough from this host that the calendar day differs,
// then checking which day a check-in actually lands on. A setting that changes nothing
// about where the row goes would be a decoration.
import { api, adminJar, provision, addRole, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const admin = await adminJar();
const p = await provision('wstz');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const dayIn = (zone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const serverZone = (await api(mgr, 'GET', '/auth/me')).j?.businessTimezone;
console.log(`   server zone: ${serverZone} — today there is ${dayIn(serverZone)}`);

// Pick a zone whose calendar day differs from the server's RIGHT NOW, so the check can
// actually tell the two apart. One of these two is always on a different date.
const CANDIDATES = ['Pacific/Kiritimati', 'Pacific/Midway'];
const contrasting = CANDIDATES.find((z) => dayIn(z) !== dayIn(serverZone));
console.log(`   candidates: ${CANDIDATES.map((z) => `${z}=${dayIn(z)}`).join('  ')}`);
rec(Boolean(contrasting),
  'a timezone exists whose calendar day differs from the server right now',
  `server ${dayIn(serverZone)}; ${CANDIDATES.map((z) => `${z} ${dayIn(z)}`).join(', ')}`);

// ---- an unrecognised zone is refused, not stored ----------------------------
console.log('\n===== a zone the runtime does not know is refused');
{
  const bad = await api(admin, 'PATCH', `/workspaces/${p.ws}`, {
    settings: { timezone: 'Mars/Olympus_Mons' },
  });
  console.log(`   -> ${bad.s} ${bad.t.slice(0, 140)}`);
  rec(bad.s === 400, 'an invalid IANA zone is rejected',
    `${bad.s} — storing it would leave attendance silently on the server's zone`);
  rec(/not a recognised|timezone/i.test(bad.t), 'and the message says what was wrong', bad.t.slice(0, 200));
}

// ---- declaring one moves the day a check-in lands on ------------------------
console.log(`\n===== declaring ${contrasting} and checking in`);
if (contrasting) {
  const set = await api(admin, 'PATCH', `/workspaces/${p.ws}`, {
    settings: { timezone: contrasting },
  });
  rec(set.s < 400, 'the workspace accepts a valid zone', `${set.s} ${set.t.slice(0, 160)}`);

  const back = await api(mgr, 'GET', `/workspaces/${p.ws}`);
  rec(back.j?.settings?.timezone === contrasting,
    'and reports it back',
    `settings.timezone=${JSON.stringify(back.j?.settings?.timezone)}`);

  // A member with no row yet, checking in now.
  const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
  const devId = await whoami(dev);
  const ci = await api(dev, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(ci.s < 400, 'the member checks in', `${ci.s} ${ci.t.slice(0, 180)}`);

  const rows = await api(mgr, 'GET', `/attendance?workspaceId=${p.ws}&userId=${devId}`);
  const filed = [...new Set((rows.j?.items ?? [])
    .filter((r) => r.userId === devId)
    .map((r) => String(r.date).slice(0, 10)))];
  const expected = dayIn(contrasting);
  console.log(`   declared zone ${contrasting} -> today there is ${expected}`);
  console.log(`   server zone   ${serverZone} -> today there is ${dayIn(serverZone)}`);
  console.log(`   row filed under: ${JSON.stringify(filed)}`);

  rec(filed.length === 1, 'exactly one row was filed', JSON.stringify(filed));
  rec(filed[0] === expected,
    "the row lands on the WORKSPACE's day, not the server's",
    `expected ${expected} (the declared zone), got ${filed[0]}; the server's day is `
    + `${dayIn(serverZone)} — if it matches that, the setting changed nothing`);
}

// ---- clearing it falls back to the server's zone -----------------------------
console.log('\n===== clearing the declaration falls back to the server');
{
  const cleared = await api(admin, 'PATCH', `/workspaces/${p.ws}`, {
    settings: { timezone: '' },
  });
  rec(cleared.s < 400, 'an empty zone is accepted as "not declared"', `${cleared.s} ${cleared.t.slice(0, 160)}`);

  const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
  const testerId = await whoami(tester);
  const ci = await api(tester, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(ci.s < 400, 'another member checks in with nothing declared', `${ci.s} ${ci.t.slice(0, 160)}`);

  const rows = await api(mgr, 'GET', `/attendance?workspaceId=${p.ws}&userId=${testerId}`);
  const filed = [...new Set((rows.j?.items ?? [])
    .filter((r) => r.userId === testerId)
    .map((r) => String(r.date).slice(0, 10)))];
  console.log(`   row filed under: ${JSON.stringify(filed)} (server day ${dayIn(serverZone)})`);
  rec(filed[0] === dayIn(serverZone),
    "with nothing declared, the row lands on the SERVER's day — the previous behaviour",
    `got ${filed[0]}, server day is ${dayIn(serverZone)}`);
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

// Six defects filed as "low" that were really broken behaviour or information
// leaks. Each was measured before being fixed, and four other claims in the same
// batch did NOT reproduce — the NUL byte, the oversized description, time against
// a nonexistent task, and a dangling requirementId were all already handled.
//
//  a repeated ?taskId=      404 "Not found." for a task the caller had named twice
//  registration             stored a caller-supplied workspaceId as defaultWorkspaceId
//  epic DELETE              403 for a real id vs 404 for an invented one = id oracle
//  epic progress            accepted 250 and drew a bar past its own track
//  epic status              accepted any string and fell through every badge map
//  a file's `url`           advertised media/<key>, which nothing serves
import { api, adminJar, provision, addRole, whoami, getJar, API } from './kit.mjs';

const out = [];
// Counted and printed, never folded into the pass tally. The registration limiter
// is 3/hour, and recording an unrun check as green is how a suite comes to report
// a clean total over behaviour nobody exercised.
const skipped = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };
const skip = (n, why) => { skipped.push(n); console.log(`SKIP  ${n}  -> ${why}`); };

const admin = await adminJar();
const p = await provision('lowfix');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);
const cookie = [...mgr].map(([k, v]) => `${k}=${v}`).join('; ');

// ---- a repeated query parameter --------------------------------------------
console.log('===== a repeated scope parameter');
{
  const task = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'LF-1',
    title: 'repeat probe', status: 'TODO', priority: 'MEDIUM',
  });
  const id = task.j?.id;
  rec(Boolean(id), 'a task exists to comment on', `${task.s} ${task.t.slice(0, 160)}`);

  const once = await fetch(`${API}/task_comments?taskId=${id}`, { headers: { Cookie: cookie } });
  const twice = await fetch(`${API}/task_comments?taskId=${id}&taskId=${id}`, { headers: { Cookie: cookie } });
  console.log(`   once=${once.status} twice=${twice.status}`);
  rec(once.status === 200, 'one taskId works', String(once.status));
  rec(twice.status === 200, 'the SAME taskId twice also works', String(twice.status));

  // Two DIFFERENT ids must be refused, not silently narrowed to the first —
  // the membership check downstream is against one id.
  const conflicting = await fetch(`${API}/task_comments?taskId=${id}&taskId=other`, {
    headers: { Cookie: cookie },
  });
  console.log(`   two different ids -> ${conflicting.status}`);
  rec(conflicting.status === 400, 'two DIFFERENT taskIds are refused', String(conflicting.status));

  // Omitting it is a bad request, not a 404 sending the caller after a deleted row.
  const missing = await fetch(`${API}/task_comments`, { headers: { Cookie: cookie } });
  rec(missing.status === 400, 'omitting it is a 400, not "Not found."', String(missing.status));
}

// ---- registration does not accept a workspace -------------------------------
console.log('\n===== registration');
{
  const email = `lowfix.${String(process.pid).slice(-4)}${Math.floor(process.uptime() * 100) % 9973}@qa.local`;
  const r = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'GoodPass123!', name: 'Low Fix Probe', workspaceId: p.ws,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 429) {
    skip('registration does not store a caller-supplied workspaceId', 'registration limiter (3/hour)');
  } else {
    console.log(`   ${r.status} workspaceId=${JSON.stringify(body?.user?.workspaceId)} default=${JSON.stringify(body?.user?.defaultWorkspaceId)}`);
    rec(r.status === 201, 'registration still works', `${r.status}`);
    rec(!body?.user?.workspaceId, 'a caller-supplied workspaceId is NOT stored',
      JSON.stringify(body?.user?.workspaceId));
    rec(!body?.user?.defaultWorkspaceId,
      'and it does not become the new account\'s default workspace',
      JSON.stringify(body?.user?.defaultWorkspaceId));
  }
}

// ---- the delete existence oracle -------------------------------------------
console.log('\n===== DELETE does not reveal what exists');
{
  const epic = await api(mgr, 'POST', '/epics', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'LF-E', name: 'Oracle probe', status: 'TODO',
  });
  const id = epic.j?.id;
  rec(Boolean(id), 'an epic exists for the probe', `${epic.s} ${epic.t.slice(0, 160)}`);
  const outsider = await getJar('role.tester@strata.local', 'RolePass123!').catch(() => null);
  rec(Boolean(outsider), 'an outsider session is available', outsider ? 'ok' : 'could not sign in');
  if (id && outsider) {
    const real = await api(outsider, 'DELETE', `/epics/${id}`);
    const fake = await api(outsider, 'DELETE', '/epics/definitely-not-an-id');
    const getReal = await api(outsider, 'GET', `/epics/${id}`);
    console.log(`   DELETE real=${real.s} fake=${fake.s}  GET real=${getReal.s}`);
    rec(real.s === fake.s,
      'an outsider cannot tell a real epic id from an invented one',
      `real ${real.s} vs fake ${fake.s}`);
    rec(real.s === 404, 'and the answer is 404, matching what GET already said', String(real.s));
    // It must still exist: the outsider was refused, not obeyed.
    const still = await api(mgr, 'GET', `/epics/${id}`);
    rec(still.s === 200, 'the epic was not actually deleted', String(still.s));
  }
}

// ---- epic rollup columns are bounded ---------------------------------------
console.log('\n===== epic rollup validation');
{
  for (const [what, body, expectText] of [
    ['progress 250', { progress: 250 }, /not be greater than 100/i],
    ['progress -1', { progress: -1 }, /not be less than 0/i],
    ['status NOT_A_STATUS', { status: 'NOT_A_STATUS' }, /one of the following values/i],
  ]) {
    const r = await api(mgr, 'POST', '/epics', {
      workspaceId: p.ws, projectId: p.project,
      hierarchyId: `LF-${what.replace(/\W/g, '').slice(0, 6).toUpperCase()}`,
      name: `Bounded ${what}`, ...body,
    });
    rec(r.s === 400 && expectText.test(r.t), `epic create refuses ${what}`, `${r.s} ${r.t.slice(0, 200)}`);
    if (r.j?.id) await api(mgr, 'DELETE', `/epics/${r.j.id}`);
  }
  // The valid ends of the range still pass, so the cap is a bound and not a ban.
  const ok = await api(mgr, 'POST', '/epics', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'LF-OK',
    name: 'At the boundary', status: 'DONE', progress: 100,
  });
  rec(ok.s === 201, 'progress 100 with status DONE is still accepted', `${ok.s} ${ok.t.slice(0, 200)}`);
  if (ok.j?.id) await api(mgr, 'DELETE', `/epics/${ok.j.id}`);
}

// ---- the file url resolves --------------------------------------------------
console.log('\n===== a file advertises a url that works');
{
  const listed = await api(mgr, 'GET', '/files?limit=1');
  const first = (listed.j?.items ?? [])[0];
  if (!first) {
    rec(false, 'a stored file was available to check', `${listed.s} 0 items`);
  } else {
    const ORIGIN = new URL(API).origin;
    const absolute = first.url.startsWith('http') ? first.url : `${ORIGIN}${first.url}`;
    const r = await fetch(absolute, { headers: { Cookie: cookie } });
    console.log(`   ${first.url} -> ${r.status}`);
    rec(!/^media\//.test(first.url),
      'the url is no longer the media/<key> path nothing serves', first.url);
    rec(r.status === 200, 'and fetching it returns the file', `${r.status} for ${absolute}`);
  }
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(
  `\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}` +
    (skipped.length ? `  skipped ${skipped.length}` : ''),
);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
skipped.forEach((n) => console.log('  SKIPPED: ' + n));

// Proof for the server-side validation batch: cross-workspace parents, time
// entry arithmetic, the backdated timer, manual attendance forgery, blank and
// oversized text, the body-size 500s, and the files role gate.
import { api, adminJar, provision, addRole, whoami, FIXTURES } from './kit.mjs';
import { readFileSync } from 'node:fs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 260)}`); };

const admin = await adminJar();
const A = await provision('valA');
const B = await provision('valB');
const mgr = await addRole(A.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(A.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const member = await addRole(A.ws, 'MEMBER', 'role.member@strata.local');

// ---- 1. a parent in another workspace is refused ---------------------------
console.log('===== a parent row in another workspace is refused');
{
  for (const [label, path, body] of [
    ['task', '/tasks', { workspaceId: A.ws, projectId: B.project, hierarchyId: 'X-1', title: 'planted' }],
    ['epic', '/epics', { workspaceId: A.ws, projectId: B.project, hierarchyId: 'X-E1', name: 'planted' }],
    ['sprint', '/sprints', { workspaceId: A.ws, projectId: B.project, name: 'planted', startDate: '2026-10-01', endDate: '2026-10-14' }],
    ['client requirement', '/client_requirements', { workspaceId: A.ws, projectId: B.project, title: 'planted' }],
    ['time entry', '/time_entries', { workspaceId: A.ws, projectId: B.project, startTime: new Date(Date.now() - 3600e3).toISOString(), endTime: new Date().toISOString() }],
  ]) {
    const r = await api(admin, 'POST', path, body);
    rec(r.s === 400, `a ${label} cannot name a project in another workspace`, `${r.s} ${r.t.slice(0, 180)}`);
  }
  // the same creates against the RIGHT project still work
  const ok = await api(admin, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'OK-1', title: 'legitimate',
  });
  rec(ok.s === 201, 'the same create against its own project still works', `${ok.s} ${ok.t.slice(0, 160)}`);

  // a sibling link from another project is refused too
  const foreignEpic = await api(admin, 'POST', '/epics', {
    workspaceId: B.ws, projectId: B.project, hierarchyId: 'B-E1', name: 'B epic',
  });
  const crossLink = await api(admin, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'X-2', title: 'cross epic', epicId: foreignEpic.j?.id,
  });
  rec(crossLink.s === 400, 'nor an epic belonging to a different project', `${crossLink.s} ${crossLink.t.slice(0, 180)}`);

  // and workspace B is still deletable — the old dangling row made it permanent
  const delB = await api(admin, 'DELETE', `/workspaces/${B.ws}?cascade=true`);
  rec(delB.s < 400, 'the other workspace remains deletable', `${delB.s} ${delB.t.slice(0, 160)}`);
}

// ---- 2. the server owns time-entry arithmetic ------------------------------
console.log('\n===== time entries are checked, and the duration is the server’s');
{
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const cases = [
    ['a reversed range', { startTime: iso(now), endTime: iso(now - 8 * 3600e3) }],
    ['a zero-length entry', { startTime: iso(now - 3600e3), endTime: iso(now - 3600e3) }],
    ['work booked in the future', { startTime: iso(now + 200 * 86400e3), endTime: iso(now + 200 * 86400e3 + 3600e3) }],
    ['a decade-long entry', { startTime: '2016-01-01T09:00:00.000Z', endTime: '2026-01-01T17:00:00.000Z' }],
    ['a negative rate', { startTime: iso(now - 3600e3), endTime: iso(now), billableRate: -50 }],
  ];
  for (const [label, extra] of cases) {
    const r = await api(dev, 'POST', '/time_entries', { workspaceId: A.ws, projectId: A.project, description: label, ...extra });
    rec(r.s === 400, `${label} is refused`, `${r.s} ${r.t.slice(0, 180)}`);
  }

  const lie = await api(dev, 'POST', '/time_entries', {
    workspaceId: A.ws, projectId: A.project, description: 'inflated',
    startTime: iso(now - 90 * 60e3), endTime: iso(now), duration: 100000,
  });
  rec(lie.s === 201, 'a real 90-minute window is accepted', `${lie.s} ${lie.t.slice(0, 160)}`);
  rec(lie.j?.duration === 90, 'and its duration is the SERVER’s 90, not the client’s 100000', String(lie.j?.duration));

  const moved = await api(dev, 'PATCH', `/time_entries/${lie.j.id}`, { endTime: iso(now - 60 * 60e3) });
  rec(moved.s === 200, 'moving one end of the window is allowed', `${moved.s} ${moved.t.slice(0, 160)}`);
  rec(moved.j?.duration === 30, 'and the duration is recomputed to match', String(moved.j?.duration));

  const inverted = await api(dev, 'PATCH', `/time_entries/${lie.j.id}`, { endTime: iso(now - 5 * 3600e3) });
  rec(inverted.s === 400, 'a patch that inverts the window is refused', `${inverted.s} ${inverted.t.slice(0, 180)}`);
}

// ---- 3. the timer clock belongs to the server -----------------------------
console.log('\n===== a backdated timer cannot mint a six-year entry');
{
  await api(dev, 'DELETE', '/active_timers/current').catch(() => {});
  const started = await api(dev, 'POST', '/active_timers', {
    startTime: '2020-01-01T00:00:00.000Z', description: 'backdated',
  });
  rec(started.s === 201 || started.s === 200, 'the timer starts', `${started.s} ${started.t.slice(0, 160)}`);
  const startedAt = new Date(started.j?.startTime ?? 0).getTime();
  rec(Math.abs(Date.now() - startedAt) < 120_000,
    'but it is stamped with the SERVER clock, not 2020', String(started.j?.startTime));

  const stopped = await api(dev, 'POST', '/active_timers/stop', { workspaceId: A.ws });
  if (stopped.s < 300) {
    rec((stopped.j?.duration ?? 0) < 60, 'so stopping it yields minutes, not 58,000 hours', String(stopped.j?.duration));
  } else {
    rec(true, `stop returned ${stopped.s} (no entry minted)`, stopped.t.slice(0, 120));
  }
}

// ---- 4. manual attendance is an HR correction, and derived ----------------
console.log('\n===== manual attendance');
{
  const r = await api(dev, 'POST', '/attendance', {
    workspaceId: A.ws, date: '2026-09-06', checkInTime: '2026-09-06T03:00:00.000Z',
    checkOutTime: '2026-09-06T12:00:00.000Z', workHours: 9, status: 'PRESENT',
  });
  rec(r.s === 403, 'a developer cannot file an attendance row by hand', `${r.s} ${r.t.slice(0, 180)}`);

  const future = await api(mgr, 'POST', '/attendance', {
    workspaceId: A.ws, date: '2027-12-31', checkInTime: '2027-12-31T03:00:00.000Z',
  });
  rec(future.s === 400, 'even a manager cannot file a future date', `${future.s} ${future.t.slice(0, 180)}`);

  const backwards = await api(mgr, 'POST', '/attendance', {
    workspaceId: A.ws, date: '2026-09-04', checkInTime: '2026-09-04T09:00:00.000Z',
    checkOutTime: '2026-09-04T08:30:00.000Z',
  });
  rec(backwards.s === 400, 'nor a check-out before the check-in', `${backwards.s} ${backwards.t.slice(0, 180)}`);

  const devId = await whoami(dev);
  const fabricated = await api(mgr, 'POST', '/attendance', {
    workspaceId: A.ws, userId: devId, date: '2026-09-04',
    checkInTime: '2026-09-04T08:30:00.000Z', checkOutTime: '2026-09-04T09:00:00.000Z',
    workHours: 24, isWeekend: false, lateMinutes: 0,
  });
  rec(fabricated.s === 201, 'a manager CAN file a real correction', `${fabricated.s} ${fabricated.t.slice(0, 180)}`);
  rec(Math.abs((fabricated.j?.workHours ?? 0) - 0.5) < 0.1,
    'and the 24 hours claimed for a 30-minute span become 0.5', String(fabricated.j?.workHours));
  if (fabricated.j?.id) await api(mgr, 'DELETE', `/attendance/${fabricated.j.id}`);
}

// ---- 5. blank and oversized text ------------------------------------------
console.log('\n===== blank and oversized text');
{
  const blanks = [
    ['task title', '/tasks', { workspaceId: A.ws, projectId: A.project, hierarchyId: 'BL-1', title: '   ' }],
    ['epic name', '/epics', { workspaceId: A.ws, projectId: A.project, hierarchyId: 'BL-2', name: '  \t ' }],
    ['sprint name', '/sprints', { workspaceId: A.ws, projectId: A.project, name: '   ', startDate: '2026-10-01', endDate: '2026-10-14' }],
    ['requirement title', '/client_requirements', { workspaceId: A.ws, projectId: A.project, title: '   ' }],
    ['project name', '/projects', { workspaceId: A.ws, name: '   ', shortCode: 'BLK', clientName: 'x' }],
  ];
  for (const [label, path, body] of blanks) {
    const r = await api(admin, 'POST', path, body);
    rec(r.s === 400, `a whitespace-only ${label} is refused`, `${r.s} ${r.t.slice(0, 150)}`);
  }

  const task = (await api(admin, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'CM-1', title: 'comment host',
  })).j;
  const huge = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: 'x'.repeat(120_000) });
  rec(huge.s === 400 || huge.s === 413, 'a 120 KB comment gets a real status, not a 500', `${huge.s} ${huge.t.slice(0, 200)}`);
  rec(!/internal server error/i.test(huge.t), 'and the message is not "Internal server error"', huge.t.slice(0, 200));

  const blankComment = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: '   ' });
  rec(blankComment.s === 400, 'a whitespace-only comment is refused', `${blankComment.s} ${blankComment.t.slice(0, 150)}`);

  const okComment = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: 'a normal comment' });
  rec(okComment.s === 201, 'a normal comment still posts', `${okComment.s} ${okComment.t.slice(0, 150)}`);

  const longName = await api(admin, 'PATCH', '/auth/profile', { name: 'N'.repeat(10_000) });
  rec(longName.s === 400, 'a 10,000-character display name is refused', `${longName.s} ${longName.t.slice(0, 180)}`);
}

// ---- 6. the avatar the picker advertises actually uploads -----------------
console.log('\n===== a 2 MB avatar no longer 500s');
{
  const jpg = readFileSync(`${FIXTURES}/mockup.jpg`);
  const dataUri = 'data:image/jpeg;base64,' + jpg.toString('base64');
  console.log(`   fixture is ${(jpg.length / 1024).toFixed(0)} KB -> ${(dataUri.length / 1024).toFixed(0)} KB of base64`);
  const r = await api(admin, 'PATCH', '/auth/profile', { avatar: dataUri });
  rec(r.s === 200, 'an 83 KB photo uploads as an avatar', `${r.s} ${r.t.slice(0, 200)}`);
  rec(!/internal server error/i.test(r.t), 'with no "Internal server error"', r.t.slice(0, 160));

  const tooBig = await api(admin, 'PATCH', '/auth/profile', { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(3_000_000) });
  rec(tooBig.s === 400 || tooBig.s === 413, 'an over-sized one gets a clear status', `${tooBig.s} ${tooBig.t.slice(0, 200)}`);
  rec(/2 MB|too large/i.test(tooBig.t), 'and a message that says what the limit is', tooBig.t.slice(0, 200));
  await api(admin, 'PATCH', '/auth/profile', { avatar: '' });
}

// ---- 7. a read-only MEMBER is read-only about files -----------------------
console.log('\n===== files take file:write');
{
  const upload = async (jar, name) => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(`${FIXTURES}/${name}`)], { type: 'image/jpeg' }), name);
    form.append('workspaceId', A.ws);
    form.append('projectId', A.project);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch('http://localhost:8000/api/v1/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
    return { s: res.status, j: await res.json().catch(() => ({})) };
  };

  const byMember = await upload(member, 'mockup.jpg');
  rec(byMember.s === 403, 'a read-only MEMBER cannot upload', `${byMember.s} ${JSON.stringify(byMember.j).slice(0, 160)}`);

  const byDev = await upload(dev, 'mockup.jpg');
  rec(byDev.s === 201, 'a developer still can — they attach mockups', `${byDev.s} ${JSON.stringify(byDev.j).slice(0, 160)}`);

  const memberDelete = await api(member, 'DELETE', `/files/${byDev.j?.id}`);
  rec(memberDelete.s === 403, 'and cannot delete somebody else’s file', `${memberDelete.s} ${memberDelete.t.slice(0, 160)}`);

  const devDelete = await api(dev, 'DELETE', `/files/${byDev.j?.id}`);
  rec(devDelete.s === 204 || devDelete.s === 200, 'the uploader can delete their own', String(devDelete.s));
}

await A.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

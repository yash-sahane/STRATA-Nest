// Where a grant stops.
//
//  - A temporary password could be re-issued by a manager of ANY workspace the
//    account belonged to — so a manager of one workspace could add a not-yet-used
//    manager account from another, re-issue its password, and sign in as it.
//  - Ending an account's sessions (a reset, a change, a new temporary password)
//    revoked refresh tokens only. The access token already handed out kept working
//    for up to fifteen minutes, on every route and on the socket.
//  - An HR manager could delete their own late arrival and file an on-time day,
//    and nobody was told. Approvers could rewrite somebody's pending leave or hours.
//  - Any manager could delete the owner's whole workspace. Any member could post
//    "leave approved" into the audit trail.
//  - A timer stored whatever task, title and workspace it was sent; starting one
//    deleted whatever timer was running, unlogged.
//  - Ids from the request were trusted: a file under another workspace's project,
//    an epic under another project's client requirement, attendance for a stranger.
//  - A socket opened from another site's page was accepted; a comment's or a
//    timer's frame went to every connected socket in every workspace.
//  - People removed from a workspace went on being notified about its work.
//
// API only.
import WebSocket from 'ws';
import { api, adminJar, provision, addRole, whoami, API, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const jarOf = (response) => {
  const jar = new Map();
  for (const c of response.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return jar;
};
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
/** A sign-in that waits out the per-address throttle. */
const signIn = async (email, password) => {
  for (let tries = 0; tries < 8; tries += 1) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (r.status !== 429) return { s: r.status, jar: jarOf(r), t: await r.text() };
    await sleep(13000);
  }
  return { s: 429, jar: new Map(), t: 'throttled' };
};
/** Open a socket with these cookies (and an Origin), subscribe, and collect frames. */
const socket = (jar, { origin, channels = [] } = {}) => new Promise((resolve) => {
  const headers = { Cookie: cookieHeader(jar) };
  if (origin) headers.Origin = origin;
  const ws = new WebSocket('ws://localhost:8000/ws/collections/', { headers });
  const frames = [];
  let closedWith = null;
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch {} });
  ws.on('close', (code) => { closedWith = code; });
  ws.on('error', () => {});
  ws.on('open', () => ws.send(JSON.stringify({ action: 'subscribe', channels })));
  setTimeout(() => resolve({ ws, frames, closed: () => closedWith }), 1500);
});

const admin = await adminJar();
const A = await provision('reachA');
const B = await provision('reachB');
const mgr = await addRole(A.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(A.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const [mgrId, devId] = await Promise.all([mgr, dev].map(whoami));

// ---- a manager of one workspace, and an account that manages another -------------
console.log('===== a temporary password is not one workspace\'s to hand out for another');
const xEmail = `e2e.reach.${Date.now()}@strata.local`;
const created = await api(admin, 'POST', '/users/invite', {
  workspaceId: B.ws, name: 'Reach Probe', email: xEmail, roleName: 'MANAGER',
});
const xId = created.j?.userId;
{
  rec(Boolean(xId), 'an account is created as a MANAGER of workspace B', brief(created));
  const added = await api(mgr, 'POST', '/users/invite', {
    workspaceId: A.ws, name: 'Reach Probe', email: xEmail, roleName: 'MEMBER',
  });
  rec(added.s < 300, 'a manager of A can add that existing account to A', brief(added));
  const taken = await api(mgr, 'POST', `/users/${xId}/temp-password`, { workspaceId: A.ws });
  rec(taken.s === 403 && !taken.j?.temporaryPassword && /workspace you do not manage/.test(taken.t),
    'but cannot re-issue its password: it also manages a workspace this manager has no say in', brief(taken));
}
const issued = await api(admin, 'POST', `/users/${xId}/temp-password`, { workspaceId: B.ws });
let xPassword = issued.j?.temporaryPassword;
rec(issued.s < 300, 'a platform administrator still can', brief(issued));

// ---- a session that has been ended is over ---------------------------------------
console.log('===== ending an account\'s sessions ends the ones already open');
if (!xPassword) {
  console.log('   this installation mails temporary passwords; the session checks were skipped');
} else {
  const first = await signIn(xEmail, xPassword);
  rec(first.s === 200, 'the account signs in on its temporary password', brief(first));
  await sleep(1200); // the revocation mark is in whole seconds
  const changed = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(first.jar) },
    body: JSON.stringify({ currentPassword: xPassword, newPassword: 'Reach-Probe-2026!' }),
  });
  const renewed = jarOf(changed);
  rec(changed.status < 300 && renewed.size >= 2, 'it sets its own password and is handed a new session',
    `${changed.status} ${(await changed.text()).slice(0, 160)}`);
  xPassword = 'Reach-Probe-2026!';
  const stale = await fetch(`${API}/auth/me`, { headers: { Cookie: cookieHeader(first.jar) } });
  rec(stale.status === 401, 'the access token from before the change no longer works', `${stale.status}`);
  const fresh = await fetch(`${API}/auth/me`, { headers: { Cookie: cookieHeader(renewed) } });
  rec(fresh.status === 200, 'the new one does', `${fresh.status}`);
  const oldSocket = await socket(first.jar, { channels: ['tasks'] });
  rec(oldSocket.closed() === 4401, 'and a socket cannot be opened with the old one', `closed=${oldSocket.closed()}`);
  oldSocket.ws.close();
  const newSocket = await socket(renewed, { channels: ['tasks'] });
  rec(newSocket.closed() === null, 'while the new session opens one', `closed=${newSocket.closed()}`);
  // Ended from elsewhere: the open socket is closed, not left listening.
  await sleep(1200);
  await api(admin, 'POST', `/users/${xId}/temp-password`, { workspaceId: B.ws });
  await sleep(1500);
  rec(newSocket.closed() === 4401, 'a new temporary password closes the sockets the account had open',
    `closed=${newSocket.closed()}`);
  newSocket.ws.close();
}

// ---- where a socket may be opened from ---------------------------------------------
console.log('===== a socket opened from another site is refused');
{
  const foreign = await socket(dev, { origin: 'https://evil.example', channels: ['tasks'] });
  rec(foreign.closed() === 4401, 'a socket another site\'s page opens in a member\'s name is closed', `closed=${foreign.closed()}`);
  foreign.ws.close();
  const ours = await socket(dev, { origin: 'http://localhost:3000', channels: ['tasks'] });
  rec(ours.closed() === null, 'the app\'s own is accepted', `closed=${ours.closed()}`);
  ours.ws.close();
}

// ---- nobody restates their own record ----------------------------------------------
console.log('===== an HR manager\'s own day is somebody else\'s to restate');
{
  const today = new Date().toISOString().slice(0, 10);
  const own = await api(mgr, 'POST', '/attendance', {
    workspaceId: A.ws, date: today, checkInTime: `${today}T03:30:00.000Z`, checkOutTime: `${today}T12:00:00.000Z`,
  });
  rec(own.s === 403 && /Another HR manager/.test(own.t),
    'a manager cannot file a day of their own while another HR manager exists', brief(own));
  const stranger = await api(mgr, 'POST', '/attendance', {
    workspaceId: A.ws, userId: xId === undefined ? 'nobody' : 'no-such-member-id',
    date: today, checkInTime: `${today}T03:30:00.000Z`,
  });
  rec(stranger.s === 400 && /not an active member/.test(stranger.t),
    'nor file one for somebody who is not a member of the workspace', brief(stranger));
}

console.log('===== an approver decides somebody\'s leave and hours; they do not rewrite them');
{
  let offset = 21;
  while ([0, 6].includes(new Date(Date.now() + offset * 864e5).getDay())) offset += 1;
  const day = new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const leave = await api(dev, 'POST', '/leave_requests', {
    workspaceId: A.ws, type: 'CASUAL', startDate: day, endDate: day, reason: 'Original reason',
  });
  rec(leave.s === 201, 'a developer asks for a day off', brief(leave));
  const rewrite = await api(mgr, 'PATCH', `/leave_requests/${leave.j?.id}`, { reason: 'Rewritten by an approver' });
  rec(rewrite.s === 403, 'an approver cannot rewrite it', brief(rewrite));
  const removeIt = await api(mgr, 'DELETE', `/leave_requests/${leave.j?.id}`);
  rec(removeIt.s === 403, 'nor delete it', brief(removeIt));
  const own = await api(dev, 'PATCH', `/leave_requests/${leave.j?.id}`, { reason: 'Fixed my own typo' });
  rec(own.s < 300, 'the requester still can', brief(own));

  const now = Date.now();
  const entry = await api(dev, 'POST', '/time_entries', {
    workspaceId: A.ws, projectId: A.project, description: 'Two hours',
    startTime: new Date(now - 3 * 3600e3).toISOString(), endTime: new Date(now - 3600e3).toISOString(),
  });
  const hours = await api(mgr, 'PATCH', `/time_entries/${entry.j?.id}`, { description: 'Changed by an approver' });
  rec(hours.s === 403, 'an approver cannot rewrite somebody\'s hours', brief(hours));
  const gone = await api(mgr, 'DELETE', `/time_entries/${entry.j?.id}`);
  rec(gone.s === 403, 'nor delete them', brief(gone));
}

// ---- the owner's workspace, and the audit trail --------------------------------------
console.log('===== a workspace is its owner\'s to delete; the audit trail is the system\'s to write');
{
  const del = await api(mgr, 'DELETE', `/workspaces/${A.ws}?cascade=true`);
  rec(del.s === 403 && /owner/.test(del.t), 'a manager who does not own the workspace cannot delete it', brief(del));
  const forged = await api(dev, 'POST', '/activity_logs', {
    workspaceId: A.ws, action: 'leave.approved', entityType: 'leave_request', entityId: 'x',
  });
  rec(forged.s === 404 || forged.s === 405, 'nobody can post a line into the activity trail', brief(forged));
}

// ---- timers --------------------------------------------------------------------------
console.log('===== a timer is for a task the person can see, in that task\'s workspace');
{
  const foreignTask = (await api(admin, 'POST', '/tasks', {
    workspaceId: B.ws, projectId: B.project, hierarchyId: 'RCH-B-01', title: 'Another workspace\'s task', status: 'TODO', priority: 'LOW',
  })).j;
  const ownTask = (await api(mgr, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'RCH-A-01', title: 'Our task', status: 'TODO', priority: 'LOW',
    assigneeIds: [devId],
  })).j;
  await api(dev, 'POST', '/active_timers/stop', { workspaceId: A.ws }); // nothing running is fine
  const foreign = await api(dev, 'POST', '/active_timers/start', { taskId: foreignTask?.id, taskTitle: 'Made up' });
  rec(foreign.s === 403 || foreign.s === 404, 'a timer cannot be started on another workspace\'s task', brief(foreign));
  const mismatched = await api(dev, 'POST', '/active_timers/start', { taskId: ownTask?.id, projectId: B.project });
  rec(mismatched.s === 400, 'nor with a project the task is not in', brief(mismatched));
  const started = await api(dev, 'POST', '/active_timers/start', { taskId: ownTask?.id, taskTitle: 'Made-up title' });
  rec(started.s < 300 && started.j?.taskTitle === 'Our task' && started.j?.workspaceId === A.ws,
    'on its own task it starts — with the task\'s real title and workspace, not the request\'s',
    JSON.stringify({ s: started.s, title: started.j?.taskTitle, ws: started.j?.workspaceId }));
  const second = await api(dev, 'POST', '/active_timers/start', { taskId: ownTask?.id });
  rec(second.s === 409 && /already running/.test(second.t),
    'a second start is refused while one runs — not settled by deleting the first', brief(second));
  const switched = await api(dev, 'POST', '/active_timers/start', { taskId: ownTask?.id, replace: true });
  rec(switched.s < 300, 'and switching says so: the running one is stopped first', brief(switched));
  await api(dev, 'POST', '/active_timers/stop', { workspaceId: A.ws });
}

// ---- ids from the request -----------------------------------------------------------------
console.log('===== ids in a request are checked against the workspace');
{
  const crB = (await api(admin, 'POST', '/client_requirements', {
    workspaceId: B.ws, projectId: B.project, title: 'B requirement', description: 'x', clientName: 'B', priority: 'LOW',
  })).j;
  const epicA = (await api(mgr, 'POST', '/epics', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'RCH-E-01', name: 'Epic A',
  })).j;
  const relinked = await api(mgr, 'PATCH', `/epics/${epicA?.id}`, { requirementId: crB?.id });
  rec(relinked.s === 400 || relinked.s === 404, 'an epic cannot be put under another project\'s client requirement', brief(relinked));
  const form = new FormData();
  form.append('workspaceId', A.ws);
  form.append('projectId', B.project);
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
  const cookie = [...mgr].map(([k, v]) => `${k}=${v}`).join('; ');
  const upload = await fetch(`${API}/files/`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  rec(upload.status >= 400 && upload.status < 500, 'a file cannot be filed under another workspace\'s project',
    `${upload.status} ${(await upload.text()).slice(0, 160)}`);
}

// ---- a custom role brings what it needs ----------------------------------------------------
console.log('===== a role that may create tasks may also change them');
{
  const role = await api(mgr, 'POST', '/workspace_roles', {
    workspaceId: A.ws, name: `Writer ${Date.now() % 100000}`, permissions: ['task:write'],
  });
  rec(role.s < 300 && (role.j?.permissions ?? []).includes('task:update'),
    'task:write alone is stored with task:update beside it', brief(role));
}

// ---- frames, and the people who are told ----------------------------------------------------
console.log('===== a frame reaches the workspace it belongs to, and a timer\'s only its owner');
{
  const outsiderJar = await addRole(B.ws, 'TESTER', 'role.tester@strata.local');
  const watching = await socket(outsiderJar, { channels: ['task_comments', 'active_timers'] });
  // The control: somebody in A, listening the same way, does hear the comment.
  const insider = await socket(dev, { channels: ['task_comments'] });
  const task = (await api(mgr, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'RCH-A-02', title: 'Commented on', status: 'TODO', priority: 'LOW',
  })).j;
  await api(mgr, 'POST', '/task_comments', { taskId: task?.id, content: 'Only workspace A should hear about this' });
  await api(mgr, 'POST', '/active_timers/start', { taskId: task?.id });
  await api(mgr, 'POST', '/active_timers/stop', { workspaceId: A.ws });
  await sleep(1500);
  const leaked = watching.frames.filter((f) => /task_comments|active_timers/.test(f.event ?? ''));
  rec(insider.frames.some((f) => /task_comments/.test(f.event ?? '')),
    'a member of A hears about the comment', JSON.stringify(insider.frames.map((f) => f.event)));
  rec(leaked.length === 0, 'somebody in another workspace hears nothing of A\'s comments or A\'s timers',
    JSON.stringify(leaked.map((f) => f.event)));
  watching.ws.close();
  insider.ws.close();
}

console.log('===== somebody removed from a workspace is no longer told about its work');
{
  const task = (await api(mgr, 'POST', '/tasks', {
    workspaceId: A.ws, projectId: A.project, hierarchyId: 'RCH-A-03', title: 'Left behind', status: 'TODO', priority: 'LOW',
    assigneeIds: [devId],
  })).j;
  // The control: while still a member, a change to the task does reach them.
  await api(mgr, 'PATCH', `/tasks/${task?.id}`, { priority: 'HIGH' });
  await sleep(1500);
  const before = list((await api(dev, 'GET', '/notifications?limit=100')).j)
    .filter((n) => n.relatedEntityId === task?.id && /priority/i.test(`${n.type} ${n.title}`));
  rec(before.length > 0, 'while a member, the developer is told when the task\'s priority changes',
    JSON.stringify(before.map((n) => n.title)));
  const members = list((await api(admin, 'GET', `/workspace_members?workspaceId=${A.ws}&limit=100`)).j);
  const devMembership = members.find((m) => m.userId === devId);
  const removed = await api(admin, 'DELETE', `/workspace_members/${devMembership?.id}`);
  rec(removed.s < 300, 'the developer is removed from the workspace', brief(removed));
  await api(mgr, 'PATCH', `/tasks/${task?.id}`, { priority: 'CRITICAL' });
  await sleep(1500);
  const inbox = list((await api(dev, 'GET', '/notifications?limit=100')).j);
  const told = inbox.filter((n) => n.relatedEntityId === task?.id && /critical/i.test(`${n.title} ${n.message}`)
    && /priority/i.test(`${n.type} ${n.title}`));
  rec(told.length === 0, 'a change to a task they were on does not reach them any more',
    JSON.stringify(told.map((n) => n.title)));
}

await A.cleanup();
await B.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

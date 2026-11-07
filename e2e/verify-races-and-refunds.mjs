// What has to stay true when two things happen at once, when a cascade takes rows
// with it, and when a refund is worked out — checked against the running stack.
//
//  - A project runs one sprint at a time. Two different sprints started together:
//    one runs, the other is refused (the database's one-active index, since the
//    advisory lock that guarded it took two pooled connections per start). One
//    sprint started twice together is announced once.
//  - A leave edit that moves the dates is checked under the same lock as a new
//    request: an edit and a new request for the same day, fired together, do not
//    both land.
//  - A refund gives back what was charged. A holiday withdrawn from inside an
//    approved leave makes it a day longer; with nothing left on the balance the
//    extra day is not charged — and cancelling the leave afterwards must not give
//    that day back.
//  - A join request is decided by approve/reject. A PATCH that rejects goes through
//    reject (the requester is told); reopening or naming a handler is refused.
//  - Deleting a project lets go of the tasks other projects depended on.
import { api, adminJar, provision, addRole, getJar, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t).slice(0, 200)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DAY = 24 * 60 * 60 * 1000;
const ymd = (d) => d.toISOString().slice(0, 10);
/** The Monday at least `after` days from now (UTC dates, as the API reads them). */
const mondayAfter = (after) => {
  const d = new Date(Date.now() + after * DAY);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 1) d.setTime(d.getTime() + DAY);
  return d;
};

const admin = await adminJar();
const p = await provision('races');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);
const extraProjects = [];
const newProject = async (name, shortCode) => {
  const r = await api(admin, 'POST', '/projects', { workspaceId: p.ws, name, shortCode, clientName: 'QA' });
  if (r.j?.id) extraProjects.push(r.j.id);
  return r.j?.id;
};
const sprintIn = async (projectId, name) =>
  (await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws, projectId, name,
    startDate: ymd(new Date(Date.now() + DAY)), endDate: ymd(new Date(Date.now() + 15 * DAY)),
  })).j?.id;

try {
  // ---- one sprint at a time -------------------------------------------------------------
  console.log('===== a project runs one sprint at a time');
  let refusedOnce = false;
  let neverTwo = true;
  for (let round = 1; round <= 3; round += 1) {
    const project = await newProject(`Race ${round}`, `RC${round}`);
    const [a, b] = [await sprintIn(project, 'Sprint A'), await sprintIn(project, 'Sprint B')];
    const [ra, rb] = await Promise.all([
      api(mgr, 'PATCH', `/sprints/${a}`, { status: 'ACTIVE' }),
      api(mgr, 'PATCH', `/sprints/${b}`, { status: 'ACTIVE' }),
    ]);
    const running = list((await api(mgr, 'GET', `/sprints?projectId=${project}&status=ACTIVE&limit=10`)).j);
    if (running.length !== 1) neverTwo = false;
    if ([ra.s, rb.s].filter((s) => s < 300).length === 1 && [ra.s, rb.s].includes(400)) refusedOnce = true;
    console.log(`   round ${round}: ${ra.s} / ${rb.s}, running ${running.length}`);
  }
  rec(neverTwo, 'two sprints of one project started together never both run');
  rec(refusedOnce, 'the one that loses is refused with a reason, not left half-started');

  const project = await newProject('Twice', 'TWC');
  const sprint = await sprintIn(project, 'Sprint Twice');
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: project, title: 'Work for the developer', sprintId: sprint, assigneeIds: [devId],
  });
  const [s1, s2] = await Promise.all([
    api(mgr, 'PATCH', `/sprints/${sprint}`, { status: 'ACTIVE' }),
    api(mgr, 'PATCH', `/sprints/${sprint}`, { status: 'ACTIVE' }),
  ]);
  rec(s1.s < 300 && s2.s < 300, 'the same sprint started twice at once: both requests succeed', `${brief(s1)} | ${brief(s2)}`);
  await sleep(1500);
  const told = list((await api(dev, 'GET', '/notifications?limit=100')).j)
    .filter((n) => n.type === 'SPRINT_STARTED' && n.relatedEntityId === sprint);
  rec(told.length === 1, 'and its team is told it started once, not twice', `${told.length} notices`);

  // ---- a leave edit is checked under the lock -------------------------------------------
  console.log('===== an edit and a new request for the same day do not both land');
  {
    const monday = mondayAfter(10);
    const tuesday = new Date(monday.getTime() + DAY);
    const first = await api(dev, 'POST', '/leave_requests', {
      workspaceId: p.ws, type: 'CASUAL', startDate: ymd(monday), endDate: ymd(monday), reason: 'one day',
    });
    rec(first.s === 201, 'a request for Monday', brief(first));
    const [moved, fresh] = await Promise.all([
      api(dev, 'PATCH', `/leave_requests/${first.j?.id}`, { startDate: ymd(tuesday), endDate: ymd(tuesday) }),
      api(dev, 'POST', '/leave_requests', {
        workspaceId: p.ws, type: 'CASUAL', startDate: ymd(tuesday), endDate: ymd(tuesday), reason: 'another',
      }),
    ]);
    const mine = list((await api(dev, 'GET', `/leave_requests?workspaceId=${p.ws}&userId=${devId}&limit=100`)).j)
      .filter((r) => ['PENDING', 'APPROVED'].includes(r.status))
      .filter((r) => String(r.startDate).slice(0, 10) <= ymd(tuesday) && String(r.endDate).slice(0, 10) >= ymd(tuesday));
    rec(mine.length === 1 && [moved.s, fresh.s].filter((s) => s < 300).length === 1,
      'exactly one of them holds Tuesday', `edit ${moved.s}, new ${fresh.s}, holding Tuesday: ${mine.length}`);
    for (const r of list((await api(dev, 'GET', `/leave_requests?workspaceId=${p.ws}&userId=${devId}&limit=100`)).j)) {
      if (r.status === 'PENDING') await api(dev, 'DELETE', `/leave_requests/${r.id}`);
    }
  }

  // ---- a refund gives back what was charged ------------------------------------------------
  console.log('===== a refund gives back what was charged');
  {
    const monday = mondayAfter(28);
    const wednesday = new Date(monday.getTime() + 2 * DAY);
    const friday = new Date(monday.getTime() + 4 * DAY);
    const year = monday.getUTCFullYear();
    const holiday = await api(mgr, 'POST', '/holidays', {
      workspaceId: p.ws, name: 'Midweek', date: ymd(wednesday), isOptional: false,
    });
    const leave = await api(dev, 'POST', '/leave_requests', {
      workspaceId: p.ws, type: 'CASUAL', startDate: ymd(monday), endDate: ymd(friday), reason: 'a week off',
    });
    rec(holiday.s === 201 && leave.s === 201 && leave.j?.daysCount === 4,
      'a week of leave around a holiday costs four days', `${brief(holiday)} | ${brief(leave)}`);
    const approved = await api(mgr, 'POST', `/leave_requests/${leave.j?.id}/approve`, {});
    rec(approved.s < 300, 'approved: four days charged', brief(approved));
    const drained = await api(mgr, 'POST', '/leave_balances/adjust', { workspaceId: p.ws, userId: devId, year, paidLeave: 0 });
    rec(drained.s < 300, 'nothing is left on the balance', brief(drained));
    const gone = await api(mgr, 'DELETE', `/holidays/${holiday.j?.id}`);
    await sleep(800);
    const longer = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
    rec(gone.s === 204 && longer?.daysCount === 5,
      'the holiday is withdrawn: the leave is five days long now, the fifth uncharged (nothing to charge it to)',
      `${gone.s} daysCount=${longer?.daysCount}`);
    const cancelled = await api(dev, 'POST', `/leave_requests/${leave.j?.id}/cancel`, {});
    const balance = (await api(dev, 'GET', `/leave_balances/me?workspaceId=${p.ws}&year=${year}`)).j;
    const left = balance?.paidLeave ?? list(balance)[0]?.paidLeave;
    rec(cancelled.s < 300 && left === 4,
      'cancelling it gives back the four days charged — not five', `cancel ${cancelled.s}, paid leave now ${left}`);
  }

  // ---- join requests ------------------------------------------------------------------
  console.log('===== a join request is decided by approve or reject');
  {
    const tester = await getJar('role.tester@strata.local');
    const asked = await api(tester, 'POST', '/join_requests', { workspaceId: p.ws, message: 'Let me in' });
    const id = asked.j?.id;
    const reopened = await api(mgr, 'PATCH', `/join_requests/${id}`, { status: 'PENDING' });
    rec(reopened.s === 400, 'a PATCH cannot set a status of its own choosing', brief(reopened));
    const named = await api(mgr, 'PATCH', `/join_requests/${id}`, { handledBy: 'somebody-else' });
    rec(named.s === 400, 'nor name who handled it', brief(named));
    const rejected = await api(mgr, 'PATCH', `/join_requests/${id}`, { status: 'REJECTED' });
    rec(rejected.s === 200 && rejected.j?.status === 'REJECTED', 'a PATCH that rejects goes through reject', brief(rejected));
    await sleep(800);
    const notes = list((await api(tester, 'GET', '/notifications?limit=100')).j);
    rec(notes.some((n) => n.type === 'JOIN_REQUEST_REJECTED' && n.relatedEntityId === id),
      'so the requester is told, as a rejection from the screen tells them');
  }

  // ---- a deleted project lets go of the tasks others depended on --------------------------
  console.log('===== a deleted project lets go of its tasks');
  {
    const doomed = await newProject('Doomed', 'DMD');
    const theirs = (await api(admin, 'POST', '/tasks', { workspaceId: p.ws, projectId: doomed, title: 'Upstream work' })).j?.id;
    const ours = (await api(admin, 'POST', '/tasks', { workspaceId: p.ws, projectId: p.project, title: 'Waits on upstream' })).j?.id;
    const linked = await api(admin, 'POST', `/tasks/${ours}/dependencies`, { targetTaskId: theirs, type: 'blockedBy' });
    const before = (await api(admin, 'GET', `/tasks/${ours}`)).j;
    rec(linked.s < 300 && (before?.blockedBy ?? []).includes(theirs),
      'a task waits on a task of another project', `${brief(linked)} blockedBy=${JSON.stringify(before?.blockedBy)}`);
    const deleted = await api(admin, 'DELETE', `/projects/${doomed}`);
    extraProjects.splice(extraProjects.indexOf(doomed), 1);
    const after = (await api(admin, 'GET', `/tasks/${ours}`)).j;
    rec(deleted.s === 204 && !(after?.blockedBy ?? []).includes(theirs),
      'deleting that project takes the deleted task off its "blocked by"', `${deleted.s} blockedBy=${JSON.stringify(after?.blockedBy)}`);
  }
} finally {
  for (const project of extraProjects) await api(admin, 'DELETE', `/projects/${project}`);
  await p.cleanup();
}

const rows = summary();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

// When something is done TO somebody's work, hours or leave, they are told.
//
//  A task assigned or moved has always been announced. These were not:
//
//  - a comment on a task — it sat under the task until somebody opened it;
//  - being taken off a task — it simply left "My tasks";
//  - a manager filing, correcting or deleting a day of somebody's attendance;
//  - an approver changing somebody's leave balance;
//  - a leave request withdrawn, by its owner or by an approver;
//  - a task moved to Review by a commit ("fixes #ID"): the worker moved it, the
//    reviewers it was waiting on were not told, and its requirement went on
//    reading "Planned".
//
//  API only — including a real, signed push webhook through the worker.
import { createHmac } from 'node:crypto';
import { api, adminJar, provision, addRole, whoami, API } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const admin = await adminJar();
const p = await provision('told');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const [mgrId, devId, testerId] = await Promise.all([mgr, dev, tester].map(whoami));

const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const mondayAfter = (after) => {
  for (let i = after; i < after + 14; i += 1) if (dayFrom(i).getDay() === 1) return i;
  throw new Error('no Monday within a fortnight');
};

/** The caller's notices about this workspace. */
const inbox = async (jar) =>
  list((await api(jar, 'GET', '/notifications?limit=100')).j).filter((n) => n.workspaceId === p.ws);
/** A notice is written after the request that caused it has answered: ask until it is there. */
const noticeFor = async (jar, wanted, ms = 9000) => {
  for (let waited = 0; waited <= ms; waited += 400) {
    const found = (await inbox(jar)).find(wanted);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return undefined;
};
const settle = (ms = 2500) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- a comment, and being taken off a task -----------------------------------------
console.log('===== a task that somebody else touches');
const task = (await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'TLD-T-01', title: 'Shared task',
  status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeIds: [testerId],
})).j;
{
  const said = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: 'Have you seen the logs?' });
  rec(said.s === 201, 'somebody comments on a task they are not on', brief(said));
  const forAssignee = await noticeFor(tester, (n) => n.type === 'TASK_COMMENT_ADDED');
  rec(Boolean(forAssignee) && /commented on "Shared task"/.test(forAssignee.message),
    'the person doing the task is told', JSON.stringify((await inbox(tester)).map((n) => n.type)));
  const forCreator = await noticeFor(mgr, (n) => n.type === 'TASK_COMMENT_ADDED');
  rec(Boolean(forCreator), 'and so is whoever raised it');
  await settle();
  rec(!(await inbox(dev)).some((n) => n.type === 'TASK_COMMENT_ADDED'),
    'the person who wrote it is not told about their own comment');
}
{
  const off = await api(mgr, 'PATCH', `/tasks/${task.id}`, { assigneeIds: [devId] });
  rec(off.s === 200, 'the task is handed from one person to another', brief(off));
  const gone = await noticeFor(tester, (n) => n.type === 'TASK_UNASSIGNED');
  rec(Boolean(gone) && /took you off "Shared task"/.test(gone.message),
    'the one taken off it is told', JSON.stringify((await inbox(tester)).map((n) => n.type)));
  rec(Boolean(await noticeFor(dev, (n) => n.type === 'TASK_ASSIGNED')),
    'and the one put on it, as before');
}

// ---- attendance restated by somebody else ---------------------------------------------
console.log('===== a day of attendance, restated by a manager');
{
  const morning = dayFrom(-1);
  morning.setHours(9, 0, 0, 0);
  const filed = await api(mgr, 'POST', '/attendance', {
    workspaceId: p.ws, userId: testerId, date: local(morning), checkInTime: morning.toISOString(),
  });
  rec(filed.s === 201, 'a manager files yesterday for somebody', brief(filed));
  const told = await noticeFor(tester, (n) => n.type === 'ATTENDANCE_CORRECTED' && /filed/.test(n.message));
  rec(Boolean(told) && new RegExp(local(morning)).test(told.message),
    'that person is told which day, and by whom', JSON.stringify((await inbox(tester)).map((n) => [n.type, n.message]).slice(0, 3)));

  const evening = new Date(morning.getTime() + 8 * 3600 * 1000);
  const fixed = await api(mgr, 'PATCH', `/attendance/${filed.j?.id}`, { checkOutTime: evening.toISOString() });
  rec(fixed.s === 200, 'the manager then corrects the time they left', brief(fixed));
  rec(Boolean(await noticeFor(tester, (n) => n.type === 'ATTENDANCE_CORRECTED' && /corrected/.test(n.message))),
    'and they are told of the correction');

  const own = await api(dev, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  await settle();
  rec(own.s < 300 && !(await inbox(dev)).some((n) => n.type === 'ATTENDANCE_CORRECTED'),
    'nobody is told about a check-in they made themselves', brief(own));
}

// ---- a leave balance, and a request withdrawn ----------------------------------------
console.log('===== leave that somebody else changes');
const year = new Date().getFullYear();
{
  const changed = await api(mgr, 'POST', '/leave_balances/adjust', {
    workspaceId: p.ws, userId: testerId, year, paidLeave: 25,
  });
  rec(changed.s === 200, 'an approver changes somebody\'s allowance', brief(changed));
  const told = await noticeFor(tester, (n) => n.type === 'LEAVE_BALANCE_ADJUSTED');
  rec(Boolean(told) && new RegExp(String(year)).test(told.message), 'and the person whose allowance it is, is told',
    JSON.stringify((await inbox(tester)).map((n) => n.type)));
}
{
  const monday = mondayAfter(21);
  const day = local(dayFrom(monday));
  const mine = await api(tester, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: day, endDate: day, reason: 'A day off',
  });
  await api(mgr, 'POST', `/leave_requests/${mine.j?.id}/approve`, {});
  const withdrawn = await api(tester, 'POST', `/leave_requests/${mine.j?.id}/cancel`, {});
  rec(withdrawn.j?.status === 'CANCELLED', 'somebody cancels leave that had been approved', brief(withdrawn));
  const told = await noticeFor(mgr, (n) => n.type === 'LEAVE_CANCELLED');
  rec(Boolean(told) && /cancelled their approved leave/.test(told.message) && new RegExp(day).test(told.message),
    'the people who approve leave are told, with the dates', JSON.stringify((await inbox(mgr)).map((n) => [n.type, n.message]).slice(0, 3)));

  const next = local(dayFrom(monday + 1));
  const theirs = await api(tester, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: next, endDate: next, reason: 'Another day',
  });
  const byApprover = await api(mgr, 'POST', `/leave_requests/${theirs.j?.id}/cancel`, {});
  rec(byApprover.j?.status === 'CANCELLED', 'an approver cancels somebody\'s request for them', brief(byApprover));
  rec(Boolean(await noticeFor(tester, (n) => n.type === 'LEAVE_CANCELLED' && /cancelled your leave request/.test(n.message))),
    'and its owner is told', JSON.stringify((await inbox(tester)).map((n) => [n.type, n.message]).slice(0, 3)));
}

// ---- a commit that moves a task ---------------------------------------------------------
console.log('===== a commit that says "fixes"');
{
  const epic = (await api(mgr, 'POST', '/epics', { workspaceId: p.ws, projectId: p.project, hierarchyId: 'TLD-E-01', name: 'Checkout' })).j;
  const requirement = (await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'TLD-FR-01', title: 'Pay by card', epicId: epic?.id,
  })).j;
  const work = (await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'TLD-T-09', title: 'Card form',
    status: 'TODO', functionalRequirementId: requirement?.id, assigneeIds: [devId],
  })).j;
  const integration = await api(mgr, 'POST', '/github_integrations', {
    workspaceId: p.ws, projectId: p.project, repoOwner: 'acme', repoName: 'shop',
    accessToken: 'ghp_not_a_real_token_for_the_test', autoUpdateStatus: true,
  });
  const rotated = await api(mgr, 'POST', `/github_integrations/${integration.j?.id}/webhook-secret`, {});
  const secret = rotated.j?.webhookSecret;
  rec(Boolean(work?.id) && Boolean(secret), 'a project is connected to a repository, with status updates on',
    `${brief(integration)} | ${brief(rotated)}`);

  const body = JSON.stringify({
    ref: 'refs/heads/main',
    commits: [{
      id: `e2e${Date.now().toString(16)}aa11bb22cc33dd44ee55ff66`,
      message: 'Validate the card number. fixes #TLD-T-09',
      timestamp: new Date().toISOString(),
      url: 'https://github.com/acme/shop/commit/e2e',
      author: { name: 'Dana Dev', email: 'dana@acme.test' },
    }],
  });
  const pushed = await fetch(`${API}/integrations/github/webhook/${p.project}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': `e2e-${Date.now()}`,
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret ?? '').update(body).digest('hex'),
    },
    body,
  });
  rec(pushed.status === 202, 'the provider delivers a push whose message says "fixes #TLD-T-09"', `${pushed.status} ${(await pushed.text()).slice(0, 160)}`);

  let moved = null;
  for (let waited = 0; waited < 20000 && moved?.status !== 'REVIEW'; waited += 500) {
    moved = (await api(mgr, 'GET', `/tasks/${work.id}`)).j;
    if (moved?.status !== 'REVIEW') await new Promise((resolve) => setTimeout(resolve, 500));
  }
  rec(moved?.status === 'REVIEW', 'the worker moves the task to Review', `status=${moved?.status}`);

  const asked = await noticeFor(mgr, (n) => n.type === 'TASK_REVIEW_REQUESTED' && /Card form/.test(n.title), 15000);
  rec(Boolean(asked) && /Dana Dev/.test(asked.message) && /commit/.test(asked.message),
    'the people who can sign it off are asked to review it, and told a commit did it',
    JSON.stringify((await inbox(mgr)).map((n) => [n.type, n.message]).slice(0, 3)));
  const summed = (await api(mgr, 'GET', `/functional_requirements/${requirement.id}`)).j;
  rec(summed?.status === 'IMPLEMENTED', 'and its requirement reads "in progress"', `status=${summed?.status}`);
  void mgrId;
  void admin;
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

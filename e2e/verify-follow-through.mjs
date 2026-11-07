// What a change is followed by, and what two changes at once leave behind.
//
//  - A client requirement's status never moved: a request whose work had all
//    shipped read "Approved", and one nobody had started could be set
//    "Completed". Once it is approved and has functional requirements, In
//    Progress and Completed follow them, and are not a person's to set.
//  - Completing a sprint read its status and then wrote it, so two completions
//    at once both closed it and both rolled its work out and told its people.
//  - Two dependency edges added to one task at once each wrote "the list plus
//    mine", and one vanished.
//  - An approved leave that had started could be neither cancelled nor
//    shortened: somebody back early stayed "on leave" to the last day.
//
//  API only: nothing here opens a page.
import { api, provision, addRole, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 240)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const p = await provision('follow');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const [, devId] = await Promise.all([whoami(mgr), whoami(dev)]);
const scope = { workspaceId: p.ws, projectId: p.project };
const post = (path, body) => api(mgr, 'POST', path, { ...scope, ...body });
const crNow = async (id) => (await api(mgr, 'GET', `/client_requirements/${id}`)).j?.status;

// ---- a client requirement follows its work ----------------------------------
console.log('===== a client requirement follows the work raised from it');
{
  const cr = (await post('/client_requirements', { title: 'Customers can pay', status: 'APPROVED' })).j;
  const fr = (await post('/functional_requirements', {
    title: 'Card payments', clientRequirementId: cr?.id,
  })).j;
  rec(Boolean(cr?.id && fr?.id), 'the fixture exists: an approved request, one requirement under it', JSON.stringify([cr?.id, fr?.id]));
  rec((await crNow(cr.id)) === 'APPROVED', 'nothing has started: it is still Approved', await crNow(cr.id));

  const done = await api(mgr, 'PATCH', `/client_requirements/${cr.id}`, { status: 'COMPLETED' });
  rec(done.s === 400 && /functional requirements/i.test(done.t),
    'Completed is not a person\'s to set over work under it', brief(done));

  const task = (await post('/tasks', { title: 'Card form', functionalRequirementId: fr.id, status: 'TODO' })).j;
  await api(mgr, 'PATCH', `/tasks/${task.id}`, { status: 'IN_PROGRESS' });
  rec((await crNow(cr.id)) === 'IN_PROGRESS', 'a task under way puts it In Progress — nobody wrote to it', await crNow(cr.id));

  await api(mgr, 'PATCH', `/tasks/${task.id}`, { status: 'REVIEW' });
  await api(mgr, 'PATCH', `/tasks/${task.id}`, { status: 'DONE' });
  rec((await crNow(cr.id)) === 'IN_PROGRESS', 'the work done but not signed off: still In Progress', await crNow(cr.id));

  const signed = await api(mgr, 'PATCH', `/functional_requirements/${fr.id}`, { status: 'DEPLOYED' });
  rec(signed.s === 200 && signed.j?.status === 'DEPLOYED', 'the requirement is signed off', brief(signed));
  rec((await crNow(cr.id)) === 'COMPLETED', 'and the request is Completed', await crNow(cr.id));

  const more = (await post('/functional_requirements', { title: 'Wallet payments', clientRequirementId: cr.id })).j;
  rec((await crNow(cr.id)) === 'IN_PROGRESS', 'new work raised under it takes it back to In Progress', await crNow(cr.id));

  const back = await api(mgr, 'PATCH', `/client_requirements/${cr.id}`, { status: 'SUBMITTED' });
  rec(back.s === 200 && back.j?.status === 'SUBMITTED', 'sending it back for a decision is a person\'s to do', brief(back));
  const again = await api(mgr, 'PATCH', `/client_requirements/${cr.id}`, { status: 'APPROVED' });
  rec(again.s === 200 && again.j?.status === 'IN_PROGRESS',
    'approved again, it says at once how far its work has got', brief(again));

  await api(mgr, 'DELETE', `/functional_requirements/${more?.id}`);
  rec((await crNow(cr.id)) === 'COMPLETED', 'the unstarted requirement deleted, what is left is all signed off', await crNow(cr.id));

  const proposed = await api(mgr, 'PATCH', `/client_requirements/${cr.id}`, { status: 'PROPOSED' });
  rec(proposed.s === 400, 'PROPOSED, which no screen offers, is refused', brief(proposed));
}

// ---- a sprint is completed once ---------------------------------------------
console.log('===== two completions of one sprint');
{
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const sprint = (await post('/sprints', { name: 'Race sprint', startDate: today, endDate: end })).j;
  await post('/tasks', { title: 'Open work', sprintId: sprint?.id, status: 'TODO', assigneeIds: [devId] });
  const started = await api(mgr, 'PATCH', `/sprints/${sprint?.id}`, { status: 'ACTIVE' });
  rec(started.s === 200, 'the sprint is running', brief(started));
  const both = await Promise.all([
    api(mgr, 'POST', `/sprints/${sprint.id}/complete`, {}),
    api(mgr, 'POST', `/sprints/${sprint.id}/complete`, {}),
  ]);
  const won = both.filter((r) => r.s === 200 || r.s === 201);
  rec(won.length === 1, 'exactly one of them completes it', both.map(brief).join(' | '));
  rec(both.some((r) => r.s === 409 || r.s === 400), 'and the other is told it already happened', both.map(brief).join(' | '));
  const told = list((await api(dev, 'GET', `/notifications?workspaceId=${p.ws}&limit=100`)).j)
    .filter((n) => /Race sprint/.test(`${n.title} ${n.message}`) && /complete/i.test(n.title));
  rec(told.length <= 1, 'its people are told once, not twice', JSON.stringify(told.map((n) => n.title)));
}

// ---- two edges on one task at once ------------------------------------------
console.log('===== two dependencies added to one task at once');
{
  const [a, b, c] = await Promise.all(['Ship', 'Build', 'Test'].map(async (title) => (await post('/tasks', { title, status: 'TODO' })).j));
  const both = await Promise.all([
    api(mgr, 'POST', `/tasks/${a.id}/dependencies`, { targetTaskId: b.id, type: 'blockedBy' }),
    api(mgr, 'POST', `/tasks/${a.id}/dependencies`, { targetTaskId: c.id, type: 'blockedBy' }),
  ]);
  rec(both.every((r) => r.s === 200 || r.s === 201), 'both are accepted', both.map(brief).join(' | '));
  const after = (await api(mgr, 'GET', `/tasks/${a.id}`)).j;
  rec([b.id, c.id].every((id) => (after?.blockedBy ?? []).includes(id)),
    'and the task waits on both: neither write lost the other', JSON.stringify(after?.blockedBy));

  const cycle = await Promise.all([
    api(mgr, 'POST', `/tasks/${b.id}/dependencies`, { targetTaskId: c.id, type: 'blockedBy' }),
    api(mgr, 'POST', `/tasks/${c.id}/dependencies`, { targetTaskId: b.id, type: 'blockedBy' }),
  ]);
  rec(cycle.filter((r) => r.s === 200 || r.s === 201).length === 1,
    'the two halves of a cycle sent at once: one is refused', cycle.map(brief).join(' | '));
}

// ---- leave under way --------------------------------------------------------
console.log('===== a leave under way is ended early, by an approver');
{
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
  const leave = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'SICK', startDate: local(dayFrom(-7)), endDate: local(dayFrom(7)), reason: 'Flu',
  });
  rec(leave.s === 201, 'a fortnight of sick leave, a week in', brief(leave));
  const approved = await api(mgr, 'POST', `/leave_requests/${leave.j?.id}/approve`, {});
  rec(approved.s === 200 || approved.s === 201, 'approved', brief(approved));

  const own = await api(dev, 'POST', `/leave_requests/${leave.j?.id}/cancel`, {});
  rec(own.s === 403 && /somebody who approves leave/i.test(own.t),
    'its owner cannot end it and take the days back: an approver does', brief(own));

  const ended = await api(mgr, 'POST', `/leave_requests/${leave.j?.id}/cancel`, {});
  const was = leave.j;
  rec(ended.s === 200 || ended.s === 201, 'an approver ends it early', brief(ended));
  rec(ended.j?.status === 'APPROVED', 'it is still approved leave — for the days taken', `status=${ended.j?.status}`);
  rec(String(ended.j?.endDate).slice(0, 10) < local(dayFrom(1)) && String(ended.j?.endDate).slice(0, 10) >= String(was?.startDate).slice(0, 10),
    'it now ends before today', `${was?.startDate}..${was?.endDate} -> ${ended.j?.endDate}`);
  const days = (r) => Number(r?.daysCount ?? r?.days);
  rec(days(ended.j) < days(was), 'and counts fewer days', `${days(was)} -> ${days(ended.j)}`);
  const told = list((await api(dev, 'GET', `/notifications?workspaceId=${p.ws}&limit=100`)).j)
    .some((n) => /ended early/i.test(`${n.title} ${n.message}`));
  rec(told, 'its owner is told it was ended early');

  const old = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'SICK', startDate: local(dayFrom(-20)), endDate: local(dayFrom(-19)), reason: 'Cold',
  });
  await api(mgr, 'POST', `/leave_requests/${old.j?.id}/approve`, {});
  const over = await api(mgr, 'POST', `/leave_requests/${old.j?.id}/cancel`, {});
  rec(over.s === 400 && /over/i.test(over.t), 'a leave that is over is a record, and stays', brief(over));
}

// ---- the screens ask; they do not download -----------------------------------
// Counting a person's work, finding a task's dependencies and answering the
// search box used to download every task in the workspace.
console.log('===== the server answers what the screens ask');
{
  const mine = (await post('/tasks', { title: 'Summarise the quarter', status: 'TODO', assigneeIds: [devId], dueDate: '2020-01-01' })).j;
  const done = (await post('/tasks', { title: 'Archive the quarter', status: 'TODO', assigneeIds: [devId] })).j;
  await api(mgr, 'PATCH', `/tasks/${done.id}`, { status: 'REVIEW' });
  await api(mgr, 'PATCH', `/tasks/${done.id}`, { status: 'DONE' });
  const summary = await api(mgr, 'GET', `/tasks/summary?workspaceId=${p.ws}`);
  const row = (summary.j?.byAssignee ?? []).find((r) => r.userId === devId);
  const devTasks = list((await api(mgr, 'GET', `/tasks?workspaceId=${p.ws}&assigneeId=${devId}&pageSize=200`)).j);
  rec(summary.s === 200 && row?.totalTasks === devTasks.length && row.completedTasks >= 1 && row.overdueTasks >= 1 && row.activeTasks === row.totalTasks - row.completedTasks,
    'one request counts a person\'s tasks: open, finished and overdue', JSON.stringify(row));
  rec(devTasks.every((t) => (t.assigneeIds ?? []).includes(devId)) && devTasks.some((t) => t.id === mine?.id),
    'and ?assigneeId= lists exactly theirs', `${devTasks.length} rows`);
  const byId = list((await api(mgr, 'GET', `/tasks?id=${mine?.id},${done?.id}`)).j);
  rec(byId.length === 2 && byId.every((t) => [mine?.id, done?.id].includes(t.id)), 'tasks are fetched by id', JSON.stringify(byId.map((t) => t.id)));
  const found = list((await api(mgr, 'GET', `/tasks?workspaceId=${p.ws}&q=quarter`)).j);
  rec(found.length === 2, '?q= searches titles, case-insensitively', JSON.stringify(found.map((t) => t.title)));
  const byCode = list((await api(mgr, 'GET', `/tasks?workspaceId=${p.ws}&q=${encodeURIComponent(String(mine?.hierarchyId).toLowerCase())}`)).j);
  rec(byCode.some((t) => t.id === mine?.id), 'and their ids', JSON.stringify(byCode.map((t) => t.hierarchyId)));
  const projects = list((await api(mgr, 'GET', `/projects?workspaceId=${p.ws}&q=${encodeURIComponent('zz-no-such-project')}`)).j);
  rec(projects.length === 0, 'a search that matches nothing finds nothing', `${projects.length} rows`);
  const stranger = await api(dev, 'GET', `/tasks/summary?workspaceId=not-my-workspace`);
  rec(stranger.s === 403 || stranger.s === 404, 'and the summary of a workspace you are not in is refused', brief(stranger));
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

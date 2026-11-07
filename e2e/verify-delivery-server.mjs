// The server keeps a requirement, its epic and its tasks in step — with no
// browser in the loop.
//
//  All of this used to be the browser's job, done as extra requests after its
//  own save had returned:
//
//  - re-summing a requirement's and an epic's status and progress whenever a
//    task under them changed;
//  - moving a requirement's tasks into a sprint with it, creating one if it had
//    none, and writing the sprint's end date over every one of them;
//  - writing a requirement's assignee list over every task under it;
//  - choosing the task's id, as `count + 1`.
//
//  So a change made by anything else — a script, an integration, a commit that
//  moves a task to Review, a tab closed between two requests — left the parents
//  describing work that no longer looked like that; and an id freed by a delete
//  was proposed again and refused.
//
//  Nothing here opens a page. Every check is one API call and then a read.
import { api, provision, addRole, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;

const p = await provision('rollup');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const [mgrId, devId, testerId] = await Promise.all([whoami(mgr), whoami(dev), whoami(tester)]);
const scope = { workspaceId: p.ws, projectId: p.project };

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const post = (path, body) => api(mgr, 'POST', path, { ...scope, ...body });
const patch = (jar, path, body) => api(jar, 'PATCH', path, body);
const get = async (path) => (await api(mgr, 'GET', path)).j;
const tasksOf = async (requirementId) => {
  const r = await get(`/tasks?functionalRequirementId=${requirementId}&limit=100`);
  return r?.items ?? r?.data ?? r ?? [];
};
// A due date names a DAY in the workspace's business timezone — the host's, for a
// workspace that has declared none (packages/config businessTimezone), and this
// script runs on the API's host. Slicing the UTC date read a due date set to the
// start of that day in IST as the day before. A date-only value (a sprint's end)
// already is the day.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const day = (value) => {
  if (!value) return value;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(text));
};
const dateOnly = (value) => (value ? String(value).slice(0, 10) : value);

const epic = (await post('/epics', { hierarchyId: 'ROL-E-01', name: 'Checkout' })).j;
const otherEpic = (await post('/epics', { hierarchyId: 'ROL-E-02', name: 'Accounts' })).j;
const solo = (await post('/functional_requirements', {
  hierarchyId: 'ROL-FR-01', title: 'Pay by card', epicId: epic?.id, priority: 'HIGH',
})).j;
const broken = (await post('/functional_requirements', {
  hierarchyId: 'ROL-FR-02', title: 'Refund a payment', epicId: epic?.id,
})).j;
const sprint = (await post('/sprints', {
  name: 'Roll-up Sprint', goal: 'checkout', startDate: today, endDate: plus(10),
})).j;
rec([epic?.id, otherEpic?.id, solo?.id, broken?.id, sprint?.id].every(Boolean),
  'the fixture exists: two epics, two requirements, a sprint',
  JSON.stringify([epic?.id, otherEpic?.id, solo?.id, broken?.id, sprint?.id]));

// ---- planning a requirement that has no tasks --------------------------------
console.log('===== a requirement planned with no tasks becomes one');
rec(solo?.status === 'DRAFT', 'it starts as a draft', `status=${solo?.status}`);
{
  const r = await patch(mgr, `/functional_requirements/${solo.id}`, { sprintId: sprint.id });
  rec(r.s === 200 && r.j?.sprintId === sprint.id, 'ONE request plans it', brief(r));
  rec(r.j?.status === 'APPROVED',
    'and the same response already reads "planned": it has a task now', `status=${r.j?.status}`);
}
const [first] = await tasksOf(solo.id);
rec(Boolean(first) && first.title === 'Pay by card' && first.sprintId === sprint.id && first.epicId === epic.id,
  'the task is the requirement itself, in its sprint, under its epic',
  JSON.stringify({ title: first?.title, sprintId: first?.sprintId, epicId: first?.epicId }));
rec(String(first?.hierarchyId ?? '').startsWith('ROL-FR-01-'),
  'its id hangs from the requirement\'s', `hierarchyId=${first?.hierarchyId}`);
rec(day(first?.dueDate) === dateOnly(sprint.endDate) && first?.status === 'BACKLOG' && first?.priority === 'HIGH',
  'due when the sprint ends, at the requirement\'s priority, waiting for the sprint to start',
  JSON.stringify({ dueDate: first?.dueDate, sprintEnd: sprint.endDate, status: first?.status, priority: first?.priority }));

// ---- planning a requirement that is already broken down ----------------------
console.log('===== planning does not overwrite what the tasks were given');
const agreed = plus(3);
const dated = (await post('/tasks', {
  hierarchyId: 'ROL-T-01', title: 'Refund API', functionalRequirementId: broken.id,
  dueDate: agreed, assigneeIds: [testerId],
})).j;
const undated = (await post('/tasks', {
  hierarchyId: 'ROL-T-02', title: 'Refund screen', functionalRequirementId: broken.id,
})).j;
await patch(mgr, `/functional_requirements/${broken.id}`, { sprintId: sprint.id });
{
  const rows = await tasksOf(broken.id);
  const a = rows.find((t) => t.id === dated?.id);
  const b = rows.find((t) => t.id === undated?.id);
  rec(rows.length === 2, 'no extra task is created for a requirement that has its own', `tasks: ${rows.length}`);
  rec(a?.sprintId === sprint.id && b?.sprintId === sprint.id,
    'both of its tasks are in the sprint', `${a?.sprintId} / ${b?.sprintId}`);
  rec(day(a?.dueDate) === agreed,
    'a date somebody had set is still that date', `dueDate=${a?.dueDate} (was ${agreed})`);
  rec(day(b?.dueDate) === dateOnly(sprint.endDate),
    'a task with no date takes the sprint\'s end', `dueDate=${b?.dueDate}`);
}

// ---- the parents are summed by the server ------------------------------------
console.log('===== a task change re-sums its requirement and its epic');
await patch(mgr, `/sprints/${sprint.id}`, { status: 'ACTIVE' });
{
  // A developer holds task:update — not requirement:write, not planning:write.
  const r = await patch(dev, `/tasks/${first.id}`, { status: 'IN_PROGRESS' });
  rec(r.s === 200, 'a developer starts the task', brief(r));
  const fr = await get(`/functional_requirements/${solo.id}`);
  const ep = await get(`/epics/${epic.id}`);
  rec(fr?.status === 'IMPLEMENTED',
    'its requirement reads "in progress", though nobody wrote to the requirement', `status=${fr?.status}`);
  // The rule was "something is DONE", so an epic with work under way read To Do.
  rec(ep?.status === 'IN_PROGRESS',
    'and so does its epic, with nothing finished yet', `status=${ep?.status} progress=${ep?.progress}`);
}
{
  await patch(dev, `/tasks/${first.id}`, { status: 'REVIEW' });
  const r = await patch(mgr, `/tasks/${first.id}`, { status: 'DONE' });
  rec(r.s === 200, 'the task is reviewed and closed', brief(r));
  const fr = await get(`/functional_requirements/${solo.id}`);
  const ep = await get(`/epics/${epic.id}`);
  rec(fr?.status === 'TESTED' && fr?.progress === 100,
    'the requirement is at 100%, every task done', `status=${fr?.status} progress=${fr?.progress}`);
  rec(ep?.progress === 33 && ep?.status === 'IN_PROGRESS',
    'the epic counts one of its three tasks', `status=${ep?.status} progress=${ep?.progress}`);
}
{
  const r = await api(mgr, 'DELETE', `/tasks/${undated.id}`);
  rec([200, 204].includes(r.s), 'a task is deleted', brief(r));
  const ep = await get(`/epics/${epic.id}`);
  rec(ep?.progress === 50, 'and the epic is re-summed without it: one of two', `progress=${ep?.progress}`);
}

// ---- where a requirement goes, its tasks go ----------------------------------
console.log('===== a requirement moved, and its tasks with it');
{
  const r = await patch(mgr, `/functional_requirements/${broken.id}`, { epicId: otherEpic.id });
  rec(r.s === 200, 'the requirement moves under another epic', brief(r));
  const [task] = await tasksOf(broken.id);
  rec(task?.epicId === otherEpic.id, 'its task is under that epic too', `epicId=${task?.epicId}`);
  const left = await get(`/epics/${epic.id}`);
  const joined = await get(`/epics/${otherEpic.id}`);
  rec(left?.progress === 100 && left?.status === 'DONE',
    'the epic it left is summed without it', `status=${left?.status} progress=${left?.progress}`);
  rec(joined?.progress === 0 && joined?.status === 'TODO',
    'the epic it joined is summed with it', `status=${joined?.status} progress=${joined?.progress}`);
}
{
  const r = await patch(mgr, `/functional_requirements/${broken.id}`, { sprintId: '' });
  rec(r.s === 200 && !r.j?.sprintId, 'the requirement is taken out of the sprint', brief(r));
  const [task] = await tasksOf(broken.id);
  rec(!task?.sprintId, 'and its task leaves with it', `sprintId=${task?.sprintId}`);
  rec(day(task?.dueDate) === agreed, 'still due when it was', `dueDate=${task?.dueDate}`);
}

// ---- the people on a requirement, and the people on its tasks ----------------
console.log('===== assigning a requirement does not flatten its tasks');
const given = (await post('/tasks', {
  hierarchyId: 'ROL-T-03', title: 'Refund email', functionalRequirementId: broken.id,
})).j;
{
  // "Refund API" was given to the tester. "Refund email" has nobody.
  const r = await patch(mgr, `/functional_requirements/${broken.id}`, { assigneeIds: [devId] });
  rec(r.s === 200, 'a developer is put on the requirement', brief(r));
  const rows = await tasksOf(broken.id);
  const own = rows.find((t) => t.id === dated.id);
  const empty = rows.find((t) => t.id === given.id);
  rec(JSON.stringify(own?.assigneeIds) === JSON.stringify([testerId]),
    'the task given to the tester is still the tester\'s', JSON.stringify(own?.assigneeIds));
  rec(JSON.stringify(empty?.assigneeIds) === JSON.stringify([devId]),
    'the task with nobody on it gets the requirement\'s person', JSON.stringify(empty?.assigneeIds));
  rec(Array.isArray(empty?.assigneeNames) && empty.assigneeNames.length === 1 && Boolean(empty.assigneeNames[0]),
    'by name as well as by id', JSON.stringify(empty?.assigneeNames));
  rec(r.j?.assigneeNames?.length === 1 && Boolean(r.j.assigneeNames[0]),
    'and the requirement names its person too, though nobody sent a name', JSON.stringify(r.j?.assigneeNames));
}
{
  await patch(mgr, `/functional_requirements/${broken.id}`, { assigneeIds: [devId, mgrId] });
  const rows = await tasksOf(broken.id);
  rec(JSON.stringify(rows.find((t) => t.id === given.id)?.assigneeIds) === JSON.stringify([devId, mgrId]),
    'a task that follows the requirement follows a second person onto it',
    JSON.stringify(rows.find((t) => t.id === given.id)?.assigneeIds));
  rec(JSON.stringify(rows.find((t) => t.id === dated.id)?.assigneeIds) === JSON.stringify([testerId]),
    'and the tester\'s task is untouched again', JSON.stringify(rows.find((t) => t.id === dated.id)?.assigneeIds));
}
{
  await patch(mgr, `/functional_requirements/${broken.id}`, { assigneeIds: [mgrId] });
  const rows = await tasksOf(broken.id);
  rec(JSON.stringify(rows.find((t) => t.id === given.id)?.assigneeIds) === JSON.stringify([mgrId]),
    'somebody taken off the requirement comes off its open task',
    JSON.stringify(rows.find((t) => t.id === given.id)?.assigneeIds));
}

// ---- ids --------------------------------------------------------------------
console.log('===== an id that is taken is not a refusal');
{
  const a = await post('/tasks', { hierarchyId: 'ROL-T-07', title: 'First' });
  const b = await post('/tasks', { hierarchyId: 'ROL-T-07', title: 'Second, proposing the same id' });
  rec(a.s === 201 && b.s === 201, 'two tasks proposing one id are both created', `${brief(a)} | ${brief(b)}`);
  rec(a.j?.hierarchyId === 'ROL-T-07' && b.j?.hierarchyId === 'ROL-T-08',
    'the second takes the next free id', `${a.j?.hierarchyId} / ${b.j?.hierarchyId}`);
}
{
  const r = await post('/epics', { hierarchyId: 'ROL-E-01', name: 'Proposes the first epic\'s id' });
  rec(r.s === 201 && r.j?.hierarchyId === 'ROL-E-03',
    'an epic likewise: the next free id, not a refusal', `${r.s} hierarchyId=${r.j?.hierarchyId} ${String(r.t).slice(0, 120)}`);
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

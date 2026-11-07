// People are told what concerns them — once, and not about what they did
// themselves — and a project is copied whole.
//
//  - deciding your own request (as its only approver) tells nobody;
//  - joining by code says nothing; being added by somebody else says so, with
//    the role;
//  - time waiting for approval is one notice until the approver has looked;
//  - an assignee hears that somebody moved their task to Review, or deleted it;
//  - a project copy is one request that commits everything or nothing, every
//    copied row pointing at copied parents, work for somebody whose access is off
//    left unassigned, and each person with work in it told once;
//  - the bell lists older notices on request, and a notice opens where its
//    business is; a link to a task on another board opens that board.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, getJar, seedNotifications, watchToasts, toasts, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t ?? JSON.stringify(r.j)).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const mondayAfter = (after) => {
  for (let i = after; i < after + 14; i += 1) if (dayFrom(i).getDay() === 1) return local(dayFrom(i));
  throw new Error('no Monday within a fortnight');
};

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('toldonce');
const code = 'TOLD';
// The caller's own notices. A platform admin's list is wide (for support), so the
// recipient is named; for everybody else the server forces it anyway.
const selves = new Map();
const notices = async (jar, ws) => {
  if (!selves.has(jar)) selves.set(jar, await whoami(jar));
  return list((await api(jar, 'GET', `/notifications?workspaceId=${ws}&userId=${selves.get(jar)}&limit=500`)).j);
};

// ---- one's own decision ------------------------------------------------------------------
console.log('===== deciding your own request tells nobody');
{
  const day = mondayAfter(45);
  const req = await api(admin, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: day, endDate: day, reason: 'decided by the only approver',
  });
  const decided = await api(admin, 'POST', `/leave_requests/${req.j?.id}/approve`, {});
  rec(req.s === 201 && decided.s < 300, 'the only approver asks for a day and approves it', `${brief(req)} | ${brief(decided)}`);
  await sleep(1500);
  const about = (await notices(admin, p.ws)).filter((n) => /leave/i.test(n.type));
  rec(about.length === 0, 'and is told nothing about a decision they made themselves', JSON.stringify(about.map((n) => n.type)));
}

// ---- joining -----------------------------------------------------------------------------
console.log('===== told when somebody else added you, not when you joined');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const intern = await addRole(p.ws, 'DEVELOPER_INTERN', 'role.developer_intern@strata.local');
const [mgrId, devId, internId] = await Promise.all([mgr, dev, intern].map(whoami));
await sleep(1200);
rec(!(await notices(dev, p.ws)).some((n) => /member_added/i.test(n.type)),
  'somebody who joined with a code is not told they were added');
{
  const direct = await api(admin, 'POST', '/users/invite', {
    name: 'Content Engineer', email: 'role.content_engineer@strata.local', roleName: 'CONTENT_ENGINEER', workspaceId: p.ws,
  });
  const ce = await getJar('role.content_engineer@strata.local');
  await sleep(1500);
  const added = (await notices(ce, p.ws)).filter((n) => /member_added/i.test(n.type));
  rec(direct.s < 300 && added.length === 1, 'somebody added by a manager is told, once',
    `${brief(direct)} | ${JSON.stringify(added.map((n) => n.message))}`);
  rec(/content engineer/i.test(added[0]?.message ?? ''), 'with the role they were given', added[0]?.message);
}

// ---- time waiting --------------------------------------------------------------------------
console.log('===== time waiting for approval is one notice until it is read');
{
  const log = (label, at) => api(dev, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, description: label, startTime: hoursAgo(at + 1), endTime: hoursAgo(at),
  });
  const first = await log('first stretch', 30);
  await sleep(1200);
  const second = await log('second stretch', 28);
  await sleep(1800);
  let waiting = (await notices(admin, p.ws)).filter((n) => n.type === 'TIME_ENTRY_SUBMITTED');
  rec(first.s === 201 && second.s === 201 && first.j?.status === 'PENDING', 'two entries are logged and wait for approval',
    `${brief(first)} | ${brief(second)}`);
  rec(waiting.length === 1, 'and the approver has one notice about them, not one each',
    JSON.stringify(waiting.map((n) => n.title)));
  if (waiting[0]) await api(admin, 'PATCH', `/notifications/${waiting[0].id}`, { isRead: true });
  await log('third stretch', 26);
  await sleep(1800);
  waiting = (await notices(admin, p.ws)).filter((n) => n.type === 'TIME_ENTRY_SUBMITTED');
  rec(waiting.length === 2 && waiting.filter((n) => !n.isRead).length === 1,
    'once it is read, the next entry is news again', JSON.stringify(waiting.map((n) => [n.title, n.isRead])));
}

// ---- review and deletion -----------------------------------------------------------------
console.log('===== an assignee hears what somebody else did to their task');
let deletedTaskId = '';
{
  const task = await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `${code}-T90`, title: 'Ship the release notes',
    status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeIds: [devId],
  });
  const moved = await api(mgr, 'PATCH', `/tasks/${task.j?.id}`, { status: 'REVIEW' });
  await sleep(1500);
  const inReview = (await notices(dev, p.ws)).filter((n) => n.type === 'TASK_STATUS_CHANGED' && /review/i.test(n.title));
  rec(task.s === 201 && moved.s === 200 && inReview.length === 1, 'a move to Review by the manager reaches the assignee',
    `${brief(task)} | ${brief(moved)} | ${JSON.stringify(inReview.map((n) => n.title))}`);
  const removed = await api(admin, 'DELETE', `/tasks/${task.j?.id}`);
  deletedTaskId = task.j?.id ?? '';
  await sleep(1500);
  const gone = (await notices(dev, p.ws)).filter((n) => n.type === 'TASK_DELETED');
  rec(removed.s === 204 && gone.length === 1, 'and so does its deletion', `${brief(removed)} | ${JSON.stringify(gone.map((n) => n.message))}`);
}

// ---- the copy ----------------------------------------------------------------------------
console.log('===== a project copied whole, in one request');
const make = async (label, path, body) => {
  const r = await api(mgr, 'POST', path, { workspaceId: p.ws, projectId: p.project, ...body });
  if (r.s !== 201) console.log(`   could not create ${label}: ${brief(r)}`);
  return r.j ?? {};
};
const cr = await make('client requirement', '/client_requirements', {
  title: 'Readers can find a release', description: '', clientName: 'QA Client', priority: 'HIGH', status: 'APPROVED',
});
const epic = await make('epic', '/epics', { hierarchyId: `${code}-EPIC-01`, name: 'Release pages', requirementId: cr.id, status: 'TODO' });
const parent = await make('parent requirement', '/functional_requirements', {
  hierarchyId: `${code}-REA-REL-LST-01`, title: 'Release list', clientRequirementId: cr.id, epicId: epic.id,
  status: 'DRAFT', complexity: 'MEDIUM', type: 'FUNCTIONAL', priority: 'HIGH',
});
const child = await make('child requirement', '/functional_requirements', {
  hierarchyId: `${code}-REA-REL-FLT-02`, title: 'Release filters', clientRequirementId: cr.id, epicId: epic.id,
  status: 'DRAFT', complexity: 'LOW', type: 'FUNCTIONAL', priority: 'MEDIUM', parentRequirementId: parent.id,
});
const sprint = await make('sprint', '/sprints', { name: 'Sprint A', goal: 'Lists', startDate: local(dayFrom(3)), endDate: local(dayFrom(17)) });
const build = await make('task', '/tasks', {
  hierarchyId: `${parent.hierarchyId}-BLD-01`, title: 'Build the list', sprintId: sprint.id, epicId: epic.id,
  functionalRequirementId: parent.id, status: 'IN_PROGRESS', priority: 'HIGH', assigneeIds: [devId],
  dueDate: local(dayFrom(10)), estimatedHours: 5,
});
const sub = await make('sub-task', '/tasks', {
  hierarchyId: `${code}-T91`, title: 'Paginate the list', parentTaskId: build.id, functionalRequirementId: parent.id,
  status: 'TODO', priority: 'LOW', assigneeIds: [devId],
});
const internWork = await make('intern task', '/tasks', {
  hierarchyId: `${code}-T92`, title: 'Write the empty state', status: 'TODO', priority: 'LOW',
  assigneeIds: [internId],
});
rec([cr, epic, parent, child, sprint, build, sub, internWork].every((row) => row.id), 'the source project has a full chain to copy');
{
  const roster = list((await api(admin, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j);
  const internMembership = roster.find((m) => m.userId === internId);
  const off = await api(admin, 'PATCH', `/workspace_members/${internMembership?.id}`, { status: 'INACTIVE' });
  rec(off.s === 200, 'and the intern\'s access is switched off', brief(off));
}

{
  const refused = await api(dev, 'POST', `/projects/${p.project}/clone`, { name: 'Not mine to copy' });
  rec(refused.s === 403, 'somebody who cannot create projects cannot copy one', brief(refused));
  const outsider = await getJar('role.tester@strata.local');
  const hidden = await api(outsider, 'POST', `/projects/${p.project}/clone`, { name: 'Not even visible' });
  rec(hidden.s === 404, 'and a project in a workspace you are not in is not found', brief(hidden));
}

const clone = await api(mgr, 'POST', `/projects/${p.project}/clone`, {
  name: 'Told Once Copy', includeTasks: true, includeSprints: true,
});
const copyId = clone.j?.id;
rec(clone.s === 201 && copyId, 'the copy is made by one request', brief(clone));
rec(clone.j?.shortCode && clone.j.shortCode !== code, 'under a project code of its own', clone.j?.shortCode);
let copiedBuild = null;
if (copyId) {
  const rows = async (collection) => list((await api(mgr, 'GET', `/${collection}?projectId=${copyId}&limit=200`)).j);
  const [tasks, frs, epics, sprints, crs] = await Promise.all(
    ['tasks', 'functional_requirements', 'epics', 'sprints', 'client_requirements'].map(rows),
  );
  rec(tasks.length === 3 && frs.length === 2 && epics.length === 1 && sprints.length === 1 && crs.length === 1,
    'with every part of the source', JSON.stringify({ tasks: tasks.length, frs: frs.length, epics: epics.length, sprints: sprints.length, crs: crs.length }));
  const [cParent, cChild] = [frs.find((f) => f.title === 'Release list'), frs.find((f) => f.title === 'Release filters')];
  rec(cChild?.parentRequirementId && cChild.parentRequirementId === cParent?.id,
    'the sub-requirement points at the copied parent', JSON.stringify({ child: cChild?.parentRequirementId, parent: cParent?.id }));
  copiedBuild = tasks.find((t) => t.title === 'Build the list');
  const cSub = tasks.find((t) => t.title === 'Paginate the list');
  rec(cSub?.parentTaskId === copiedBuild?.id && copiedBuild?.functionalRequirementId === cParent?.id
    && copiedBuild?.epicId === epics[0]?.id && copiedBuild?.sprintId === sprints[0]?.id && epics[0]?.requirementId === crs[0]?.id,
  'every task points at its copied parent, requirement, epic and sprint',
  JSON.stringify({ sub: cSub?.parentTaskId, build: copiedBuild?.id, fr: copiedBuild?.functionalRequirementId, epic: copiedBuild?.epicId, sprint: copiedBuild?.sprintId }));
  const sourceIds = [cr, epic, parent, child, sprint, build, sub, internWork].map((row) => row.id);
  const leaked = JSON.stringify([tasks, frs, epics, sprints, crs]);
  rec(sourceIds.every((id) => !leaked.includes(`"${id}"`)), 'and none of them points back into the source');
  rec(tasks.every((t) => String(t.hierarchyId).startsWith(clone.j.shortCode)), 'the hierarchy ids carry the new code',
    tasks.map((t) => t.hierarchyId).join(', '));
  rec(tasks.every((t) => t.status === 'TODO') && sprints[0]?.status === 'PLANNING', 'the work starts To Do, the sprint in Planning',
    JSON.stringify({ tasks: tasks.map((t) => t.status), sprint: sprints[0]?.status }));
  const cIntern = tasks.find((t) => t.title === 'Write the empty state');
  rec(Array.isArray(cIntern?.assigneeIds) && cIntern.assigneeIds.length === 0 && clone.j?.copied?.assignmentsDropped === 1,
    'work for somebody whose access is off is copied unassigned, and the reply says so',
    JSON.stringify({ assignees: cIntern?.assigneeIds, copied: clone.j?.copied }));
  await sleep(2500);
  const told = (await notices(dev, p.ws)).filter((n) => n.projectId === copyId);
  rec(told.length === 1 && /2 tasks/.test(told[0]?.title ?? ''), 'the developer is told once about both of their tasks in the copy',
    JSON.stringify(told.map((n) => n.title)));
}

// ---- screens -------------------------------------------------------------------------------
console.log('===== the clone dialog');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/projects', 6000);
  await watchToasts(page);
  // The card's menu names its project.
  await page.getByRole('button', { name: 'Actions for toldonce Project' }).click();
  await page.getByRole('menuitem', { name: 'Clone Project' }).click();
  const dialog = page.getByRole('dialog');
  const opened = await dialog.waitFor({ timeout: 8000 }).then(() => true, () => false);
  rec(opened, 'Clone Project opens its dialog');
  if (opened) {
    const sprints = dialog.locator('#clone-sprints');
    const before = await sprints.getAttribute('data-state');
    // The row highlights on hover; a click on its words — not the box — toggles it.
    await dialog.getByText('Sprint names, goals and dates', { exact: false }).click();
    const after = await sprints.getAttribute('data-state');
    rec(before === 'unchecked' && after === 'checked', 'a click anywhere on an option\'s row ticks it', `${before} -> ${after}`);
    await dialog.locator('#clone-name').fill('Told Once From Screen');
    await dialog.getByRole('button', { name: 'Clone Project' }).click();
    const closed = await dialog.waitFor({ state: 'hidden', timeout: 30000 }).then(() => true, () => false);
    await page.waitForTimeout(1500);
    const shown = (await toasts(page)).join(' | ');
    rec(closed && /Project cloned/.test(shown) && /3 tasks/.test(shown), 'cloning closes it and says what came with the copy', shown);
    rec(await page.getByText('Told Once From Screen', { exact: true }).first().isVisible().catch(() => false),
      'and the copy is on the list');
  }
  rec(errors.length === 0, 'the projects page threw nothing', errors.join(' | '));
  await ctx.close();
}

console.log('===== the bell');
{
  const seeded = await seedNotifications(p.ws, mgrId, 55);
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/dashboard', 5000);
  await page.getByRole('button', { name: /^Notifications/ }).first().click();
  const older = page.getByRole('button', { name: /^Show older \(\d+ more\)$/ });
  const offered = await older.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(seeded === 55 && offered, 'with more notices than one page, the bell offers the older ones', `seeded=${seeded}`);
  if (offered) {
    const countBefore = await page.getByRole('button', { name: /^(Open|Mark as read): / }).count();
    await older.click();
    await page.waitForTimeout(2500);
    const countAfter = await page.getByRole('button', { name: /^(Open|Mark as read): / }).count();
    rec(countAfter > countBefore, 'and shows them when asked', `${countBefore} -> ${countAfter}`);
  }
  await ctx.close();
}

console.log('===== a notice opens where its business is');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await visit(page, '/dashboard', 5000);
  await page.getByRole('button', { name: /^Notifications/ }).first().click();
  const row = page.getByRole('button', { name: /^(Open|Mark as read): Time waiting for your approval/ }).first();
  const there = await row.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(there, 'the approver\'s bell has the time notice');
  if (there) {
    await row.click();
    await page.waitForURL(/\/time-tracking/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const selected = await page.getByRole('tab', { name: /Approvals/ }).getAttribute('aria-selected').catch(() => null);
    rec(/\/time-tracking\?tab=approvals/.test(page.url()) && selected === 'true', 'and it opens the Approvals tab',
      `${page.url()} selected=${selected}`);
  }
  await ctx.close();
}

console.log('===== a task link that is not on this board');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await watchToasts(page);
  if (copiedBuild?.id) {
    await visit(page, `/tasks?projectId=${p.project}&taskId=${copiedBuild.id}`, 7000);
    rec(page.url().includes(`projectId=${copyId}`), 'a link to a task in another project switches to that project\'s board', page.url());
    const title = await page.getByRole('dialog').getByText('Build the list').first().isVisible().catch(() => false);
    rec(title, 'and opens the task there');
    await page.keyboard.press('Escape');
  }
  await page.goto(`http://localhost:3000/tasks?projectId=${p.project}&taskId=${deletedTaskId}`, { waitUntil: 'domcontentloaded' });
  await watchToasts(page);
  await page.waitForTimeout(7000);
  const shown = (await toasts(page)).join(' | ');
  rec(/That task no longer exists/.test(shown), 'a link to a deleted task says so instead of opening nothing', shown);
  rec(errors.length === 0, 'the board threw nothing', errors.join(' | '));
  await ctx.close();
}

await browser.close();
await p.cleanup();
summary();

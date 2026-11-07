// The delivery chain can be walked from either end, and each step is taken
// where you stand.
//
//  - a task says what it delivers — requirement, epic, sprint, parent — as links;
//    its card carries its id and every assignee;
//  - an epic names its client requirement and opens its requirements and tasks;
//    a requirement names its epic and opens its tasks;
//  - "Raise an epic", "Add a functional requirement", "Add a task" open the next
//    form with the parent already chosen;
//  - review is done in the task: submitted, sent back with a note, approved;
//  - the sprint's three views share a header that starts and completes it, and
//    the way back keeps the project; starting it makes the project Active;
//  - a completed sprint keeps its goal, dates and finished work;
//  - a signed-off requirement reopens when new work appears under it;
//  - a project's page reaches all of its work and opens what changed;
//  - "my tasks" means assigned to me, and a task row opens that task;
//  - nobody is offered an empty menu or told to use a button they do not have.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, watchToasts, toasts, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t ?? JSON.stringify(r.j)).slice(0, 200)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const flat = (text) => String(text).replace(/\s+/g, ' ');

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('chain');
const P = p.project;
const code = 'CHAI';
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const [mgrId, devId] = await Promise.all([mgr, dev].map(whoami));

const make = async (label, path, body, jar = mgr) => {
  const r = await api(jar, 'POST', path, { workspaceId: p.ws, projectId: P, ...body });
  if (r.s !== 201) console.log(`   could not create ${label}: ${brief(r)}`);
  return r.j ?? {};
};
const cr = await make('client requirement', '/client_requirements', {
  title: 'Shoppers can pay by card', description: '', clientName: 'QA Client', priority: 'HIGH', status: 'APPROVED',
});
const epic = await make('epic', '/epics', { hierarchyId: `${code}-EPIC-01`, name: 'Checkout', requirementId: cr.id, status: 'TODO' });
const fr = await make('requirement', '/functional_requirements', {
  hierarchyId: `${code}-SHO-CHE-CRD-01`, title: 'Card form', clientRequirementId: cr.id, epicId: epic.id,
  status: 'DRAFT', complexity: 'MEDIUM', type: 'FUNCTIONAL', priority: 'HIGH',
});
const sprint = await make('sprint', '/sprints', { name: 'Chain Sprint', goal: 'Take a card payment', startDate: local(dayFrom(0)), endDate: local(dayFrom(13)) });
const build = await make('task', '/tasks', {
  hierarchyId: `${fr.hierarchyId}-FRM-01`, title: 'Build the card form', sprintId: sprint.id, epicId: epic.id,
  functionalRequirementId: fr.id, status: 'IN_PROGRESS', priority: 'HIGH', assigneeIds: [devId],
});
const sub = await make('sub-task', '/tasks', {
  hierarchyId: `${code}-T02`, title: 'Validate the card number', parentTaskId: build.id, functionalRequirementId: fr.id,
  sprintId: sprint.id, status: 'TODO', priority: 'LOW', assigneeIds: [devId, mgrId],
});
rec([cr, epic, fr, sprint, build, sub].every((row) => row.id), 'a chain exists: requirement, epic, functional requirement, sprint, tasks');

// ---- the task says what it delivers --------------------------------------------------
console.log('===== a task names what it delivers');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${P}&taskId=${sub.id}`, 7000);
  const dialog = page.getByRole('dialog');
  const opened = await dialog.getByText('Delivers', { exact: true }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(opened, 'the task dialog has a Delivers section');
  if (opened) {
    const hrefOf = async (name) => dialog.getByRole('link', { name }).first().getAttribute('href').catch(() => null);
    rec((await hrefOf(/Shoppers can pay by card/)) === `/requirements?projectId=${P}&crId=${cr.id}`, 'its client requirement, as a link', await hrefOf(/Shoppers/));
    rec((await hrefOf(/Checkout/)) === `/epics?projectId=${P}&epicId=${epic.id}`, 'its epic, as a link', await hrefOf(/Checkout/));
    rec((await hrefOf(/Card form/)) === `/functional-requirements?projectId=${P}&frId=${fr.id}`, 'its functional requirement, as a link', await hrefOf(/Card form/));
    rec((await hrefOf(/Chain Sprint/)) === `/sprints/${sprint.id}/board`, 'its sprint, as a link', await hrefOf(/Chain Sprint/));
    rec((await hrefOf(/Build the card form/)) === `/tasks?projectId=${P}&taskId=${build.id}`, 'and the task it is part of — by name, not id', await hrefOf(/Build the card form/));
    const raw = flat(await dialog.innerText());
    rec(!raw.includes(build.id), 'no raw id is shown for the parent');
    await page.keyboard.press('Escape');
  }
  // All tasks: "my tasks" holds back work in a sprint still being planned, as it should.
  await visit(page, `/tasks?projectId=${P}&scope=all`, 6000);
  const card = page.getByRole('button', { name: 'Open task: Validate the card number' }).first();
  const cardText = flat(await card.innerText().catch(() => ''));
  rec(cardText.includes(`${code}-T02`), 'the board card carries the task id', cardText.slice(0, 160));
  const who = await card.locator('[aria-label^="Assigned to"]').first().getAttribute('aria-label').catch(() => null);
  rec(Boolean(who) && /,/.test(who ?? ''), 'and names every assignee, not only the first', String(who));
  rec(errors.length === 0, 'the tasks page threw nothing', errors.join(' | '));
  await ctx.close();
}

// ---- the chain, both ways ---------------------------------------------------------------
console.log('===== epics and requirements link both ways, and make the next thing in place');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/epics?projectId=${P}&epicId=${epic.id}`, 7000);
  const dialog = page.getByRole('dialog');
  const delivers = await dialog.getByRole('link', { name: 'Shoppers can pay by card' }).first().getAttribute('href').catch(() => null);
  rec(delivers === `/requirements?projectId=${P}&crId=${cr.id}`, 'an epic names the client requirement it delivers', String(delivers));
  const frRow = await dialog.getByRole('link', { name: /Card form/ }).first().getAttribute('href').catch(() => null);
  rec(frRow === `/functional-requirements?projectId=${P}&frId=${fr.id}`, 'its functional requirements open', String(frRow));
  const taskRow = await dialog.getByRole('link', { name: /Build the card form/ }).first().getAttribute('href').catch(() => null);
  rec(taskRow === `/tasks?projectId=${P}&taskId=${build.id}`, 'and so do its tasks', String(taskRow));
  rec(!/\bIN_PROGRESS\b|\bTODO\b/.test(flat(await dialog.innerText().catch(() => ''))), 'statuses read as words, not codes');

  // "Add a functional requirement" — the epic chosen already.
  await dialog.getByRole('link', { name: 'Add a functional requirement' }).first().click();
  await page.waitForURL(/\/functional-requirements/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const frForm = page.getByRole('dialog');
  const frFormText = flat(await frForm.innerText().catch(() => ''));
  rec(/Checkout/.test(frFormText), 'Add a functional requirement opens the form with the epic chosen', frFormText.slice(0, 300));
  rec(!/action=create/.test(page.url()), 'and the request leaves the address bar', page.url());
  await page.keyboard.press('Escape');

  // "Add a task" from the requirement — the requirement chosen already.
  await visit(page, `/functional-requirements?projectId=${P}&frId=${fr.id}`, 7000);
  const partOf = await page.getByRole('dialog').getByRole('link', { name: /Checkout/ }).first().getAttribute('href').catch(() => null);
  rec(partOf === `/epics?projectId=${P}&epicId=${epic.id}`, 'a functional requirement names its epic', String(partOf));
  await page.getByRole('dialog').getByRole('link', { name: 'Add a task' }).first().click();
  await page.waitForURL(/\/tasks/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const taskForm = flat(await page.getByRole('dialog').innerText().catch(() => ''));
  rec(/Card form/.test(taskForm), 'Add a task opens the form with the requirement chosen', taskForm.slice(0, 300));
  await page.keyboard.press('Escape');

  // "Raise an epic" from the client requirement.
  await visit(page, `/requirements?projectId=${P}&crId=${cr.id}`, 7000);
  await page.getByRole('dialog').getByRole('link', { name: 'Raise an epic' }).first().click();
  await page.waitForURL(/\/epics/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const epicForm = flat(await page.getByRole('dialog').innerText().catch(() => ''));
  rec(/Shoppers can pay by card/.test(epicForm), 'Raise an epic opens the form with the requirement chosen', epicForm.slice(0, 300));
  rec(!new RegExp(cr.id).test(epicForm), 'and names requirements by title, not id');
  await page.keyboard.press('Escape');
  rec(errors.length === 0, 'none of it threw', errors.join(' | '));
  await ctx.close();
}

// ---- review, in the task -------------------------------------------------------------------
console.log('===== review is done in the task');
const statusOf = async (id) => (await api(mgr, 'GET', `/tasks/${id}`)).j?.status;
{
  const devSide = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(devSide.page, `/tasks?projectId=${P}&taskId=${build.id}`, 7000);
  const submit = devSide.page.getByRole('dialog').getByRole('button', { name: 'Submit for review' });
  const offered = await submit.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(offered, 'the assignee is offered Submit for review');
  if (offered) {
    await submit.click();
    await devSide.page.waitForTimeout(2500);
  }
  rec((await statusOf(build.id)) === 'REVIEW', 'which puts the task in Review', String(await statusOf(build.id)));
  rec(!(await devSide.page.getByRole('dialog').getByRole('button', { name: /Approve/ }).count()),
    'somebody who does not sign off is not offered Approve');
  await devSide.ctx.close();

  const mgrSide = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(mgrSide.page, `/tasks?projectId=${P}&taskId=${build.id}`, 7000);
  const d = mgrSide.page.getByRole('dialog');
  await d.getByRole('button', { name: 'Send back' }).click().catch(() => {});
  await d.getByLabel('What needs another look?').fill('The expiry date field is missing.').catch(() => {});
  await d.getByRole('button', { name: 'Send back to In Progress' }).click().catch(() => {});
  await mgrSide.page.waitForTimeout(3000);
  rec((await statusOf(build.id)) === 'IN_PROGRESS', 'the approver can send it back', String(await statusOf(build.id)));
  const comments = list((await api(mgr, 'GET', `/task_comments?taskId=${build.id}`)).j);
  rec(comments.some((c) => /expiry date field is missing/.test(c.content)), 'and the note is posted on the task',
    JSON.stringify(comments.map((c) => c.content)));
  await api(dev, 'PATCH', `/tasks/${build.id}`, { status: 'REVIEW' });
  await visit(mgrSide.page, `/tasks?projectId=${P}&taskId=${build.id}`, 7000);
  await mgrSide.page.getByRole('dialog').getByRole('button', { name: 'Approve — mark Done' }).click().catch(() => {});
  await mgrSide.page.waitForTimeout(3000);
  rec((await statusOf(build.id)) === 'DONE', 'and approve it, from the dialog', String(await statusOf(build.id)));
  await mgrSide.ctx.close();
}

// ---- the sprint's header ---------------------------------------------------------------------
console.log('===== one header for the sprint, wherever you look at it');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await watchToasts(page);
  for (const [path, label] of [['board', 'Board'], ['backlog', 'Planning'], ['analytics', 'Analytics']]) {
    await visit(page, `/sprints/${sprint.id}/${path}`, 6000);
    const nav = page.getByRole('navigation', { name: 'Sprint views' });
    const current = await nav.locator('[aria-current="page"]').innerText().catch(() => '');
    // The header's own way back — the sidebar has a Sprints link of its own.
    const back = await page.locator('main').getByRole('link', { name: 'Sprints', exact: true }).first().getAttribute('href').catch(() => null);
    rec(current.trim() === label && back === `/sprints?projectId=${P}`,
      `${label}: the three views are named alike, and the way back keeps the project`, `${current} | ${back}`);
  }
  await visit(page, `/sprints/${sprint.id}/board`, 6000);
  const start = page.getByRole('button', { name: 'Start Sprint' });
  const canStart = await start.waitFor({ timeout: 8000 }).then(() => true, () => false);
  rec(canStart, 'a planned sprint can be started from its own board');
  if (canStart) {
    await start.click();
    await page.waitForTimeout(3000);
  }
  const stored = (await api(mgr, 'GET', `/sprints/${sprint.id}`)).j;
  rec(stored?.status === 'ACTIVE', 'which starts it', String(stored?.status));
  const project = (await api(mgr, 'GET', `/projects/${P}`)).j;
  rec(project?.status === 'ACTIVE', 'and the project, Planning until now, is Active', String(project?.status));

  // The dashboard shortcut to the board that is running.
  await visit(page, '/dashboard', 6000);
  const shortcut = await page.getByRole('link', { name: /Chain Sprint/ }).first().getAttribute('href').catch(() => null);
  rec(shortcut === `/sprints/${sprint.id}/board`, 'the dashboard links straight to the running sprint', String(shortcut));

  await visit(page, `/sprints/${sprint.id}/analytics`, 6000);
  await page.getByRole('button', { name: 'Complete Sprint' }).click().catch(() => {});
  await page.getByRole('alertdialog').getByRole('button', { name: 'Complete Sprint' }).click().catch(() => {});
  await page.waitForTimeout(4000);
  const closed = (await api(mgr, 'GET', `/sprints/${sprint.id}`)).j;
  rec(closed?.status === 'COMPLETED', 'and completed from any of its views', String(closed?.status));
  rec(errors.length === 0, 'the sprint pages threw nothing', errors.join(' | '));
  await ctx.close();
}

// ---- a completed sprint is a record -------------------------------------------------------------
console.log('===== a completed sprint keeps what it was');
{
  const goal = await api(mgr, 'PATCH', `/sprints/${sprint.id}`, { goal: 'Something else entirely' });
  rec(goal.s === 400, 'its goal cannot be rewritten', brief(goal));
  const rename = await api(mgr, 'PATCH', `/sprints/${sprint.id}`, { name: 'Chain Sprint (closed)' });
  rec(rename.s === 200, 'it can still be renamed', brief(rename));
  const gone = await api(mgr, 'DELETE', `/sprints/${sprint.id}`);
  rec(gone.s === 409, 'and it is not deleted while it holds the work it finished', brief(gone));

  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/sprints?projectId=${P}`, 6000);
  const cardText = flat(await page.locator('main').innerText().catch(() => ''));
  rec(cardText.includes('Chain Sprint (closed)'), 'the list opens on the project it was asked for');
  const deleteButtons = await page.getByRole('button', { name: 'Delete sprint' }).count();
  rec(deleteButtons === 0, 'and offers no Delete for a sprint that keeps its work', `delete buttons: ${deleteButtons}`);
  // Each card's Edit names its sprint.
  await page.getByRole('button', { name: /^Edit Chain Sprint/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const note = flat(await page.getByRole('dialog').innerText().catch(() => ''));
  rec(/This sprint is complete/.test(note), 'its edit form says only the name can change', note.slice(0, 200));
  await ctx.close();
}

// ---- a signed-off requirement reopens -------------------------------------------------------------
console.log('===== "Done" is a sign-off of finished work, not a lock');
{
  const shipped = await make('requirement', '/functional_requirements', {
    hierarchyId: `${code}-SHO-CHE-RCP-02`, title: 'Receipt email', clientRequirementId: cr.id, epicId: epic.id,
    status: 'DRAFT', complexity: 'LOW', type: 'FUNCTIONAL', priority: 'MEDIUM',
  });
  const only = await make('task', '/tasks', {
    hierarchyId: `${shipped.hierarchyId}-SND-01`, title: 'Send the receipt', functionalRequirementId: shipped.id,
    status: 'REVIEW', priority: 'MEDIUM', assigneeIds: [devId],
  });
  await api(mgr, 'PATCH', `/tasks/${only.id}`, { status: 'DONE' });
  const signed = await api(mgr, 'PATCH', `/functional_requirements/${shipped.id}`, { status: 'DEPLOYED' });
  rec(signed.s === 200, 'a requirement with all its work done is signed off', brief(signed));
  await make('task', '/tasks', {
    hierarchyId: `${shipped.hierarchyId}-BUG-02`, title: 'Receipt shows the wrong total', functionalRequirementId: shipped.id,
    status: 'TODO', priority: 'HIGH', assigneeIds: [devId],
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = (await api(mgr, 'GET', `/functional_requirements/${shipped.id}`)).j;
  rec(after?.status === 'APPROVED' && after?.progress === 50, 'new work under it reopens it, at what is really done',
    JSON.stringify({ status: after?.status, progress: after?.progress }));
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/functional-requirements?projectId=${P}`, 6000);
  const row = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/Ready/.test(row) && !/\bPlanned\b/.test(row), 'and reads "Ready" — not "Planned" — while it is not in a sprint', row.slice(0, 300));
  await ctx.close();
}

// ---- the project's page, the dashboard, and what read-only people are offered ----------------------
console.log('===== a project page reaches its work; my tasks are mine; nothing is offered that does not work');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(page, `/projects/${P}`, 6000);
  const nav = page.getByRole('navigation', { name: 'This project' });
  const places = await nav.getByRole('link').allInnerTexts().catch(() => []);
  rec(['Requirements', 'Epics', 'Sprints', 'Tasks'].every((place) => places.includes(place)),
    'the project page links to its requirements, epics, sprints and tasks', places.join(' | '));
  rec(!places.includes('Settings'), 'and offers Settings only to those who may change it', places.join(' | '));
  rec((await page.getByRole('tab', { name: 'Settings' }).count()) === 0, 'there is no Settings tab of one button');
  const remembered = await page.evaluate(() => localStorage.getItem('selected-project-id'));
  rec(remembered === P, 'opening it makes it the project the other pages open on', String(remembered));
  const updates = await page.locator('a[href*="taskId="], a[href*="epicId="], a[href^="/sprints/"]').count();
  rec(updates > 0, 'and its recent updates open what changed', `links: ${updates}`);

  await visit(page, '/projects', 6000);
  // Each card's menu names its project.
  const menus = page.getByRole('button', { name: /^Actions for / });
  let empty = 0;
  for (let i = 0; i < (await menus.count()); i += 1) {
    await menus.nth(i).click();
    const items = await page.getByRole('menuitem').count();
    if (items === 0) empty += 1;
    await page.keyboard.press('Escape');
  }
  rec(empty === 0, 'no project card opens an empty menu', `empty menus: ${empty}`);

  await visit(page, '/dashboard', 6000);
  await page.getByRole('tab', { name: 'My Tasks' }).click().catch(() => {});
  await page.waitForTimeout(800);
  // A row that goes to a page is labelled by a link (RowLink), not a button.
  const row = page.getByRole('link', { name: /^Open task: / }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForURL(/taskId=/, { timeout: 10000 }).catch(() => {});
  }
  rec(/\/tasks\?projectId=.*&taskId=/.test(page.url()), 'a task on the dashboard opens that task', page.url());

  const empty2 = await make('sprint', '/sprints', { name: 'Next Sprint', goal: '', startDate: local(dayFrom(20)), endDate: local(dayFrom(33)) });
  await visit(page, `/sprints/${empty2.id}/backlog`, 6000);
  const text = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/Whoever plans the sprints adds requirements to it/.test(text) && !/Use .Add to Sprint./.test(text),
    'somebody who does not plan is not told to use "Add to Sprint"', text.slice(0, 300));
  rec(errors.length === 0, 'none of these pages threw', errors.join(' | '));
  await ctx.close();
}

await browser.close();
await p.cleanup();
summary();

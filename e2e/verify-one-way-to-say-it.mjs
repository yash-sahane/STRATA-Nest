// One definition, one screen, one wording — for things that had several.
//
//  - "Overdue" was computed five ways. Four of them compared the due date to the
//    current instant, so a task due TODAY was overdue on Analytics, the calendar
//    and project health while the dashboard called it "Due today".
//  - The dashboard's "My Tasks" counted finished tasks above a list of open
//    ones, and its "Active Projects" counted projects still being planned.
//  - Team Performance — each person's figures side by side — was open to
//    everybody, the people being compared included.
//  - A project had two edit forms behind one permission; a password had two
//    change forms; "access denied" was drawn four ways.
//  - "Backlog" named a task status, the sprint planning page, and the list of
//    requirements not in the sprint.
//  - Global search could not find a client requirement, and a client
//    requirement did not show what had come of it.
//  - "Confirm & Save All" kept a generated requirement's complexity and dropped
//    its priority and type.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const flat = (text) => String(text).replace(/\s+/g, ' ');
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const browser = await chromium.launch();
const p = await provision('oneway');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const [mgrId, testerId] = await Promise.all([mgr, tester].map(whoami));

const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const task = (hierarchyId, title, extra) => api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId, title, status: 'TODO', priority: 'MEDIUM', ...extra,
});

// The tester's work: one task due today, one due yesterday, one finished.
await task('ONE-T-01', 'Due today', { assigneeIds: [testerId], dueDate: local(new Date()) });
await task('ONE-T-02', 'Due yesterday', { assigneeIds: [testerId], dueDate: local(dayFrom(-1)) });
const finished = (await task('ONE-T-03', 'Finished long ago', { assigneeIds: [testerId], dueDate: local(dayFrom(-9)) })).j;
for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE']) await api(mgr, 'PATCH', `/tasks/${finished.id}`, { status });
// Somebody else's deadline, sooner than either.
await task('ONE-T-04', 'The manager\'s own', { assigneeIds: [mgrId], dueDate: local(dayFrom(-3)) });

// The chain a client requirement starts.
const cr = (await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, title: 'Zebra crossing checkout', description: 'What the client asked for', priority: 'HIGH',
})).j;
const epic = (await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'ONE-E-01', name: 'Checkout epic', requirementId: cr?.id,
})).j;
await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'ONE-FR-01', title: 'Pay by card',
  epicId: epic?.id, clientRequirementId: cr?.id,
});
const sprint = (await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Wording Sprint', startDate: local(new Date()), endDate: local(dayFrom(7)),
})).j;

// ---- what "Confirm & Save All" keeps ------------------------------------------------
console.log('===== a generated requirement keeps what the preview showed');
{
  const saved = await api(mgr, 'POST', '/bulk-save', {
    workspaceId: p.ws, projectId: p.project, projectCode: 'ONE',
    generated: {
      functionalRequirements: [
        { title: 'Generated requirement', description: 'From the model', priority: 'High', type: 'technical', complexity: 'Very High' },
      ],
    },
  });
  rec(saved.s < 300, 'a generated tree is saved', brief(saved));
  const stored = list((await api(mgr, 'GET', `/functional_requirements?projectId=${p.project}&limit=100`)).j)
    .find((fr) => fr.title === 'Generated requirement');
  rec(stored?.priority === 'HIGH' && stored?.type === 'TECHNICAL',
    'its priority and type are saved, not only its complexity',
    JSON.stringify({ priority: stored?.priority, type: stored?.type }));
  rec(stored?.complexity === 'VERY_HIGH',
    'and "Very High" is stored as the value the application has, not as written',
    `complexity=${stored?.complexity}`);
}

// ---- somebody who delivers ------------------------------------------------------------
const mine = await signedInPage(browser, 'role.tester@strata.local', p.ws);
console.log('===== the dashboard, for somebody who delivers');
await visit(mine.page, '/dashboard', 9000);
{
  const body = flat(await mine.page.locator('main').innerText().catch(() => ''));
  rec(/My Open Tasks\s*2\b/.test(body), '"My Open Tasks" counts the two that are open, not the finished one',
    body.slice(body.indexOf('My Open Tasks'), body.indexOf('My Open Tasks') + 80) || body.slice(0, 300));
  rec(/Active Projects\s*0\b/.test(body) && /1 in planning/.test(body),
    'a project still being planned is not counted as active', body.slice(body.indexOf('Active Projects'), body.indexOf('Active Projects') + 80));
  rec(/My Deadlines/.test(body) && /Due yesterday/.test(body) && !/The manager.s own/.test(body),
    'the deadlines are their own, not the whole workspace\'s', body.slice(body.indexOf('Deadlines') - 4, body.indexOf('Deadlines') + 260));
  rec(/Due today/.test(body) && /1 day overdue/.test(body),
    'due today reads "Due today"; yesterday\'s is a day overdue', body.slice(body.indexOf('Deadlines'), body.indexOf('Deadlines') + 260));
}
console.log('===== Team Performance is not for the people being compared');
await visit(mine.page, '/analytics?view=team', 9000);
{
  rec((await mine.page.getByRole('tab', { name: 'Team Performance' }).count()) === 0,
    'a tester is not offered the tab');
  rec((await mine.page.getByRole('tab', { name: 'Workspace Overview', selected: true }).count()) > 0,
    'and a link straight to it lands on the overview instead',
    (await mine.page.getByRole('tab').allInnerTexts()).join(' | '));
}
console.log('===== "that is not yours to do here"');
await visit(mine.page, '/settings?tab=workspace', 8000);
{
  const body = flat(await mine.page.locator('main').innerText().catch(() => ''));
  rec(/You don.t have access to this/.test(body) && /change this workspace.s settings/.test(body),
    'workspace settings say what cannot be done, in one wording', body.slice(0, 400));
  rec(!/Access Denied/.test(body) && !/Only workspace managers/.test(body),
    'without inventing who could ("only workspace managers")', body.slice(0, 300));
}
await mine.ctx.close();

// ---- somebody answerable for the team ----------------------------------------------
const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
console.log('===== the same day, for a manager');
await visit(page, '/dashboard', 9000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/Team Deadlines/.test(body) && /The manager.s own/.test(body) && /Due yesterday/.test(body),
    'a manager sees the team\'s deadlines', body.slice(body.indexOf('Deadlines') - 6, body.indexOf('Deadlines') + 260));
}
await visit(page, '/analytics', 9000);
{
  rec((await page.getByRole('tab', { name: 'Team Performance' }).count()) > 0, 'and is offered Team Performance');
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  // Two tasks are past their day: yesterday's and the manager's. Today's is not.
  rec(/Overdue Tasks\s*2\b/.test(body), 'Analytics counts two overdue tasks — not the one due today as well',
    body.slice(body.indexOf('Overdue Tasks') - 4, body.indexOf('Overdue Tasks') + 60) || body.slice(0, 300));
}
await visit(page, '/calendar', 9000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/Overdue Tasks\s*2\b/.test(body), 'and the calendar agrees with it',
    body.slice(body.indexOf('Overdue Tasks') - 4, body.indexOf('Overdue Tasks') + 60));
}

console.log('===== one way to edit a project');
await visit(page, '/projects', 8000);
{
  // Each card's menu names its project.
  await page.getByRole('button', { name: /^Actions for / }).first().click();
  const items = (await page.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  console.log(`   project menu: ${JSON.stringify(items)}`);
  rec(items.filter((t) => /^Project Settings$/.test(t)).length === 1 && !items.includes('Settings'),
    'the menu has one "Project Settings" — the name of the page it opens — and no second "Settings"', JSON.stringify(items));
  await page.getByRole('menuitem', { name: 'Project Settings' }).click();
  await page.waitForURL(/\/settings$/, { timeout: 15000 }).catch(() => {});
  rec(/\/projects\/[^/]+\/settings$/.test(page.url()), 'which opens the project\'s own page', page.url());
  await page.waitForTimeout(4000);
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(!/Methodology/.test(body), 'where "Methodology" — a choice of one — is no longer offered', body.slice(0, 300));
}
await visit(page, `/projects/${p.project}`, 8000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/People on This Project/.test(body) && /2 people have tasks here/.test(body),
    'the project says who is working on it, from its tasks', body.slice(body.indexOf('People on') - 2, body.indexOf('People on') + 120) || body.slice(0, 300));
}

console.log('===== one place to change a password');
await visit(page, '/settings?tab=security', 8000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(!/Coming Soon/.test(body) && !/Two-Factor/.test(body), 'no feature is promised that does not exist', body.slice(0, 300));
  rec((await page.locator('input[type="password"]').count()) === 0, 'the tab carries no second password form');
  // A link, not a button: it goes somewhere (and can be opened in a new tab).
  await page.getByRole('link', { name: 'Change Password' }).click();
  await page.waitForURL(/change-password/, { timeout: 15000 }).catch(() => {});
  rec(/change-password/.test(page.url()), 'its link leads to the one change-password page', page.url());
}

console.log('===== planning a sprint is called planning');
await visit(page, '/sprints', 8000);
{
  rec((await page.getByRole('button', { name: 'Plan', exact: true }).count()) > 0 &&
      (await page.getByRole('button', { name: 'Backlog', exact: true }).count()) === 0,
    'the sprint\'s planning page is reached by "Plan", not "Backlog"');
  await visit(page, `/sprints/${sprint.id}/backlog`, 8000);
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/Not in a Sprint \(/.test(body) && /In This Sprint \(/.test(body) && !/FR Backlog/.test(body),
    'and its two lists are "In This Sprint" and "Not in a Sprint"', body.slice(0, 400));
}

console.log('===== a client requirement can be found, and shows what came of it');
await visit(page, '/dashboard', 6000);
{
  const box = page.getByPlaceholder('Search tasks, projects, requirements...').first();
  await box.fill('Zebra crossing');
  await page.waitForTimeout(4000);
  const results = flat(await page.locator('header').innerText().catch(() => '') + ' ' + await page.locator('body').innerText().catch(() => ''));
  rec(/Client requirements \(1\)/.test(results) && /Zebra crossing checkout/.test(results),
    'the search box finds it, under its own name', results.slice(results.indexOf('Found'), results.indexOf('Found') + 240));
  await page.keyboard.press('Escape');
}
await visit(page, `/requirements?projectId=${p.project}&crId=${cr.id}`, 8000);
{
  const dialog = page.getByRole('dialog');
  const opened = await dialog.getByText('What came of it').waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(opened, 'its detail has a "What came of it" section');
  const text = flat(await dialog.innerText().catch(() => ''));
  rec(/1 epic/.test(text) && /1 functional requirement/.test(text) && /Checkout epic/.test(text) && /Pay by card/.test(text),
    'listing the epic raised from it and the functional requirement under that',
    text.slice(text.indexOf('What came of it'), text.indexOf('What came of it') + 240));
}

rec(errors.length === 0 && mine.errors.length === 0, 'no page threw while any of this ran',
  [...errors, ...mine.errors].join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

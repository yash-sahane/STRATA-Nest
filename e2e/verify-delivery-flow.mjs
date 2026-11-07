// The delivery chain holds together: requirement -> task -> sprint.
//
//  Four things about it were true only by luck:
//
//  - A task's sprint and epic were whatever the New Task form sent. The form has
//    no sprint field, so a task added under a requirement that was already in
//    the running sprint was created outside it, with no way to put it in; and
//    its epic was a second, independent choice, which is how an epic listed
//    requirements with work in progress beside "Tasks 0 / 0".
//
//  - A functional requirement could not be edited. Title, description, type,
//    priority, complexity, epic and parent were fixed at creation; a typo meant
//    deleting it, which cut its tasks loose.
//
//  - A completed sprint could still be re-planned and added to, so the result
//    it recorded stopped matching what was in it. A sprint that had never been
//    started could be "completed".
//
//  - The sprint's retrospective notes were shown but nothing could write them.
import { chromium, api, provision, addRole, signedInPage, visit } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;

const browser = await chromium.launch();
const p = await provision('delivery');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const scope = { workspaceId: p.ws, projectId: p.project };

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const post = async (path, body) => (await api(mgr, 'POST', path, { ...scope, ...body }));

// ---- a project with two epics, two requirements and two sprints -------------
const epicA = (await post('/epics', { hierarchyId: 'DLV-E-01', name: 'Checkout' })).j?.id;
const epicB = (await post('/epics', { hierarchyId: 'DLV-E-02', name: 'Accounts' })).j?.id;
const planned = (await post('/functional_requirements', {
  hierarchyId: 'DLV-FR-01', title: 'Pay by card', epicId: epicA, priority: 'HIGH',
})).j?.id;
const loose = (await post('/functional_requirements', {
  hierarchyId: 'DLV-FR-02', title: 'Reset pasword', epicId: epicA, priority: 'MEDIUM',
})).j?.id;
const sprint = (await post('/sprints', {
  name: 'Delivery Sprint', goal: 'ship checkout', startDate: today, endDate: plus(7),
})).j?.id;
const unstarted = (await post('/sprints', {
  name: 'Next Sprint', goal: 'later', startDate: plus(8), endDate: plus(15),
})).j?.id;
rec([epicA, epicB, planned, loose, sprint, unstarted].every(Boolean),
  'the fixture exists: two epics, two requirements, two sprints',
  JSON.stringify({ epicA, epicB, planned, loose, sprint, unstarted }));

// ---- a task follows the requirement it belongs to ---------------------------
console.log('===== a task follows its requirement');
{
  const r = await api(mgr, 'PATCH', `/functional_requirements/${planned}`, { sprintId: sprint });
  rec(r.s === 200 && r.j?.sprintId === sprint, 'the requirement is planned into the sprint', brief(r));
}

const early = await post('/tasks', {
  hierarchyId: 'DLV-T-01', title: 'Card form', functionalRequirementId: planned,
});
rec(early.j?.sprintId === sprint && early.j?.epicId === epicA,
  'a task added under a planned requirement joins its sprint and its epic',
  `sprintId=${early.j?.sprintId} epicId=${early.j?.epicId} (${brief(early)})`);
rec(early.j?.status === 'BACKLOG',
  'before the sprint starts it waits in the backlog', `status=${early.j?.status}`);

{
  const r = await api(mgr, 'PATCH', `/sprints/${sprint}`, { status: 'ACTIVE' });
  rec(r.s === 200 && r.j?.status === 'ACTIVE', 'the sprint starts', brief(r));
}

const late = await post('/tasks', {
  hierarchyId: 'DLV-T-02', title: 'Card errors', functionalRequirementId: planned,
});
rec(late.j?.sprintId === sprint && late.j?.status === 'TODO',
  'a task added once the sprint is running lands on its board, at To Do',
  `sprintId=${late.j?.sprintId} status=${late.j?.status} (${brief(late)})`);

const free = await post('/tasks', { hierarchyId: 'DLV-T-03', title: 'Loose end' });
rec(free.s === 201 && !free.j?.sprintId && !free.j?.epicId,
  'a task under no requirement is in no sprint and no epic',
  `sprintId=${free.j?.sprintId} epicId=${free.j?.epicId}`);

{
  // Moved under the planned requirement, it goes where that requirement is.
  const r = await api(mgr, 'PATCH', `/tasks/${free.j?.id}`, { functionalRequirementId: planned });
  rec(r.j?.sprintId === sprint && r.j?.epicId === epicA,
    'moving a task under a requirement moves it into that requirement\'s sprint and epic',
    `sprintId=${r.j?.sprintId} epicId=${r.j?.epicId} (${brief(r)})`);
}

// ---- a sprint is completed once, after it has started -----------------------
console.log('===== completing a sprint');
{
  const r = await api(mgr, 'POST', `/sprints/${unstarted}/complete`);
  rec(r.s === 400 && /has been started/.test(r.t),
    'a sprint that was never started cannot be completed', brief(r));
}

// One task goes all the way through, so the sprint has something to record.
for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE']) {
  await api(mgr, 'PATCH', `/tasks/${late.j?.id}`, { status });
}
{
  const r = await api(mgr, 'POST', `/sprints/${sprint}/complete`);
  rec([200, 201].includes(r.s) && r.j?.status === 'COMPLETED',
    'the running sprint completes', brief(r));
}

// ---- and after that it is a record ------------------------------------------
console.log('===== a completed sprint is read-only');
{
  const r = await post('/tasks', { hierarchyId: 'DLV-T-04', title: 'Too late', sprintId: sprint });
  rec(r.s === 400 && /sprint is completed/.test(r.t),
    'no task can be created in a completed sprint', brief(r));
}
{
  const r = await api(mgr, 'PATCH', `/functional_requirements/${loose}`, { sprintId: sprint });
  rec(r.s === 400 && /is completed/.test(r.t),
    'no requirement can be planned into a completed sprint', brief(r));
}
{
  const done = (await api(mgr, 'GET', `/tasks/${late.j?.id}`)).j;
  rec(done?.sprintId === sprint, 'the finished task stays in the sprint that finished it',
    `sprintId=${done?.sprintId}`);
  const r = await api(mgr, 'PATCH', `/tasks/${late.j?.id}`, { status: 'IN_PROGRESS' });
  rec(r.s === 200 && !r.j?.sprintId,
    'reopening it takes it out of the closed sprint, back where it can be planned',
    `sprintId=${r.j?.sprintId} (${brief(r)})`);
}

// ---- the screens -------------------------------------------------------------
const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

console.log('===== a functional requirement can be edited');
await visit(page, '/functional-requirements', 6000);
{
  const head = (await page.locator('thead th').allInnerTexts()).map((t) => t.trim());
  console.log(`   columns: ${JSON.stringify(head)}`);
  rec(['Status', 'Epic', 'Sprint'].every((c) => head.includes(c)),
    'the list says which epic and sprint each requirement is in, and its status',
    JSON.stringify(head));

  const row = page.locator('tbody tr', { hasText: 'Reset pasword' }).first();
  const listed = await row.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(listed, 'the requirement is listed', `rows: ${await page.locator('tbody tr').count()}`);
  if (listed) {
    await row.click();
    const detail = page.getByRole('dialog');
    const editButton = detail.getByRole('button', { name: 'Edit', exact: true });
    const offered = await editButton.waitFor({ timeout: 10000 }).then(() => true, () => false);
    rec(offered, 'its detail offers Edit', (await detail.innerText().catch(() => '')).slice(0, 200));
    if (offered) {
      await editButton.click();
      const form = page.getByRole('dialog', { name: 'Edit Functional Requirement' });
      const opened = await form.waitFor({ timeout: 10000 }).then(() => true, () => false);
      rec(opened, 'Edit opens the form on the requirement, titled as an edit',
        (await page.getByRole('dialog').allInnerTexts()).join(' | ').slice(0, 200));
      if (opened) {
        const title = form.getByLabel(/^Title/);
        rec((await title.inputValue()) === 'Reset pasword',
          'the form holds what the requirement holds', await title.inputValue());
        await title.fill('Reset password');
        await form.getByRole('button', { name: 'Save Changes' }).click();
        await form.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const stored = (await api(mgr, 'GET', `/functional_requirements/${loose}`)).j;
        rec(stored?.title === 'Reset password' && stored?.epicId === epicA && stored?.priority === 'MEDIUM',
          'the new title is saved, and nothing that was left alone is rewritten',
          JSON.stringify({ title: stored?.title, epicId: stored?.epicId, priority: stored?.priority }));
        const shown = await page.locator('tbody tr', { hasText: 'Reset password' }).count();
        rec(shown > 0, 'and the list shows it', `rows with the new title: ${shown}`);
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

console.log('===== "every task is done" is not "done": a person signs it off');
{
  const r = await api(mgr, 'PATCH', `/functional_requirements/${loose}`, { status: 'TESTED' });
  rec(r.s === 200, 'the requirement reaches the status its tasks give it', brief(r));
  await visit(page, '/functional-requirements', 6000);
  const row = page.locator('tbody tr', { hasText: 'Reset password' }).first();
  const text = await row.innerText().catch(() => '');
  rec(/Tasks Done/.test(text) && !/Tested/i.test(text),
    'which the list calls "Tasks Done", not "Tested"', text.replace(/\s+/g, ' ').slice(0, 200));
  await row.click().catch(() => {});
  const sign = page.getByRole('dialog').getByRole('button', { name: 'Mark as Done' });
  const offered = await sign.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(offered, 'its detail offers Mark as Done');
  if (offered) {
    await sign.click();
    await page.waitForTimeout(2500);
    const stored = (await api(mgr, 'GET', `/functional_requirements/${loose}`)).j;
    rec(stored?.status === 'DEPLOYED', 'and pressing it closes the requirement', `status=${stored?.status}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

console.log('===== New Task: one parent, not two');
await visit(page, '/tasks?action=create', 6000);
{
  const dialog = page.getByRole('dialog', { name: 'Create Task' });
  const opened = await dialog.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(opened, 'New Task opens');
  if (opened) {
    const epicField = dialog.getByText('Epic (Optional)', { exact: true });
    rec((await epicField.count()) > 0, 'with no requirement chosen, the task can name an epic');
    // Named by its placeholder: the trigger carries that as its aria-label.
    const picker = dialog.getByRole('combobox', { name: 'Select functional requirement' });
    const pickable = await picker.waitFor({ timeout: 10000 }).then(() => true, () => false);
    rec(pickable, 'and it can be filed under a requirement',
      JSON.stringify(await dialog.locator('label').allInnerTexts()));
    if (pickable) {
      await picker.click();
      await page.getByRole('option', { name: /Reset password/ }).click();
      await page.waitForTimeout(800);
      rec((await epicField.count()) === 0,
        'once a requirement is chosen the separate epic choice is gone',
        `epic fields on screen: ${await epicField.count()}`);
      const note = await dialog.getByText(/joins this requirement.s epic/).count();
      rec(note > 0, 'and the form says where the task will go');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

console.log('===== a completed sprint on screen');
await visit(page, `/sprints/${sprint}/backlog`, 6000);
{
  const body = await page.locator('body').innerText().catch(() => '');
  rec(/Reset password|Pay by card/.test(body), 'the planning page loads its requirements',
    body.replace(/\s+/g, ' ').slice(0, 200));
  const add = await page.getByRole('button', { name: 'Add to Sprint' }).count();
  const remove = await page.getByRole('button', { name: 'Remove from Sprint' }).count();
  rec(add === 0 && remove === 0,
    'it offers neither Add to Sprint nor Remove from Sprint',
    `Add to Sprint: ${add}, Remove from Sprint: ${remove}`);
}

await visit(page, `/sprints/${sprint}/analytics`, 6000);
{
  const add = page.getByRole('button', { name: 'Add Notes' });
  const offered = await add.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(offered, 'the sprint\'s analytics page offers to write the retrospective',
    (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  if (offered) {
    await add.click();
    await page.getByLabel('Retrospective notes').fill('Card errors took longer than planned.');
    await page.getByRole('button', { name: 'Save Notes' }).click();
    await page.waitForTimeout(2500);
    const stored = (await api(mgr, 'GET', `/sprints/${sprint}`)).j;
    rec(stored?.retrospectiveNotes === 'Card errors took longer than planned.',
      'the notes are saved on the sprint', `retrospectiveNotes=${JSON.stringify(stored?.retrospectiveNotes)}`);
    const shown = await page.getByText('Card errors took longer than planned.').count();
    rec(shown > 0, 'and shown where they were written');
    rec((await page.getByRole('button', { name: 'Edit', exact: true }).count()) > 0,
      'with a way to change them afterwards');
  }
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

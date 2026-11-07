// A task's logged time is the task's, and a running timer is visible from anywhere.
//
//  - The task's time card was built on the personal entry list, so "Total
//    Logged" was the total of whoever happened to be looking: a developer on a
//    task two colleagues had worked on read only their own minutes, and the
//    over-estimate warning fired on one person's share.
//
//  - A timer showed only inside the card of the task it was started from. Close
//    the task and nothing on any screen said a clock was still counting.
import { chromium, api, provision, addRole, getJar, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const flat = (text) => String(text).replace(/\s+/g, ' ');
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const browser = await chromium.launch();
const p = await provision('timevis');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const [devId, testerId] = await Promise.all([dev, tester].map(whoami));

const task = (await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'TV-T-01', title: 'Shared piece of work',
  status: 'IN_PROGRESS', priority: 'MEDIUM', estimatedHours: 2, assigneeIds: [devId, testerId],
})).j;
rec(Boolean(task?.id), 'a task two people work on exists', JSON.stringify(task).slice(0, 160));

/** A finished entry of `minutes`, ending `agoMinutes` ago. */
const log = (jar, minutes, agoMinutes) => {
  const end = new Date(Date.now() - agoMinutes * 60000);
  const start = new Date(end.getTime() - minutes * 60000);
  return api(jar, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, taskId: task.id,
    startTime: start.toISOString(), endTime: end.toISOString(),
    description: 'A private note about how the time went', isBillable: true,
  });
};
const a = await log(dev, 90, 300);
const b = await log(tester, 60, 120);
rec(a.s === 201 && b.s === 201, 'the developer logs 1h 30m on it and the tester 1h', `${brief(a)} | ${brief(b)}`);

// ---- the API -------------------------------------------------------------------
console.log('===== what a member may know about a task\'s time');
{
  const own = list((await api(tester, 'GET', `/time_entries?workspaceId=${p.ws}&taskId=${task.id}`)).j);
  rec(own.length === 1 && own[0].userId === testerId,
    'the entries themselves stay personal: the tester lists only their own', `${own.length} rows`);
  const r = await api(tester, 'GET', `/time_entries/task-summary?taskId=${task.id}`);
  const s = r.j;
  rec(r.s === 200 && s?.totalMinutes === 150 && s?.people === 2 && s?.mine?.totalMinutes === 60,
    'the total is everybody\'s: 2h 30m from two people, an hour of it the tester\'s', brief(r));
  rec(!/private note|userName|userEmail/.test(r.t),
    'and it carries nobody\'s name or note', r.t.slice(0, 300));
  // Somebody who is not in this workspace at all.
  const outsider = await getJar('role.developer_intern@strata.local');
  const denied = await api(outsider, 'GET', `/time_entries/task-summary?taskId=${task.id}`);
  rec(denied.s === 403, 'somebody outside the workspace is refused', brief(denied));
}

// ---- the card --------------------------------------------------------------------
console.log('===== the task\'s time card');
const { ctx, page, errors } = await signedInPage(browser, 'role.tester@strata.local', p.ws);
await visit(page, `/tasks?taskId=${task.id}`, 9000);
{
  const dialog = page.getByRole('dialog');
  const opened = await dialog.getByText('Time Tracking').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(opened, 'the task opens with its time card');
  const text = flat(await dialog.innerText().catch(() => ''));
  rec(/Total Logged\s*2h 30m/.test(text), 'Total Logged is the whole team\'s 2h 30m, not the viewer\'s 1h',
    text.slice(text.indexOf('Total Logged'), text.indexOf('Total Logged') + 160));
  rec(/by 2 people/.test(text) && /1h yours/.test(text), 'and it says whose it is: two people, an hour of it yours',
    text.slice(text.indexOf('Total Logged'), text.indexOf('Total Logged') + 160));
  rec(/Over estimate by 30m/.test(text), 'the estimate is measured against the real total',
    text.slice(text.indexOf('Progress'), text.indexOf('Progress') + 200));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

// ---- the timer -------------------------------------------------------------------
console.log('===== a timer running in the background');
{
  const before = await page.getByRole('link', { name: /Timer (running|paused) on/ }).count();
  rec(before === 0, 'with no timer running the header carries no timer');
  const started = await api(tester, 'POST', '/active_timers/start', {
    taskId: task.id, taskTitle: task.title, taskHierarchyId: task.hierarchyId, projectId: p.project,
  });
  rec(started.s < 300, 'a timer is started on the task', brief(started));
  // A page that has nothing to do with the task.
  await visit(page, '/dashboard', 7000);
  const chip = page.getByRole('link', { name: /Timer running on TV-T-01/ });
  const shown = await chip.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(shown, 'the header says so, on a page that has nothing to do with the task',
    flat(await page.locator('header').innerText().catch(() => '')).slice(0, 300));
  if (shown) {
    const first = await chip.innerText();
    await page.waitForTimeout(2200);
    const second = await chip.innerText();
    rec(first !== second, 'and it is counting', `${flat(first)} -> ${flat(second)}`);
    await chip.click();
    await page.waitForURL(/taskId=/, { timeout: 15000 }).catch(() => {});
    rec(page.url().includes(`taskId=${task.id}`), 'pressing it leads to the task that can stop it', page.url());
  }
  const stopped = await api(tester, 'POST', '/active_timers/stop', { workspaceId: p.ws });
  console.log(`   timer stopped for cleanup: ${stopped.s}`);
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

// The leave and attendance screens say what the API now knows.
//
//  The rules themselves are pinned against the API in verify-hr-rules.mjs. This
//  is the other half: that the person looking at the screen is told.
//
//  - somebody who is the only approver can decide their own request, and is
//    told why; everybody else is told who their request is waiting for;
//  - the team calendar says who is away to people who do not approve leave —
//    and does not say what kind of leave it is to anybody;
//  - the leave form lets sickness be recorded afterwards, and counts a declared
//    holiday out of what a request costs;
//  - a shift still running from yesterday can be checked out of, and a day whose
//    check-out was forgotten is pointed out to its owner and to the manager.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { dayButton, inPicker, pickDate } from './date-picker.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 200)}`;
const flat = (text) => String(text).replace(/\s+/g, ' ');

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('hrscreens');

const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const isWorking = (d) => {
  const day = d.getDay();
  if (day === 0) return false;
  if (day !== 6) return true;
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return [1, 3].includes(Math.ceil((d.getDate() + first) / 7));
};
const mondayAfter = (after) => {
  for (let i = after; i < after + 14; i += 1) if (dayFrom(i).getDay() === 1) return i;
  throw new Error('no Monday within a fortnight');
};
const workingDayFrom = (after) => {
  for (let i = after; i < after + 14; i += 1) if (isWorking(dayFrom(i))) return i;
  throw new Error('no working day within a fortnight');
};

// ---- the only approver ---------------------------------------------------------
console.log('===== the only approver, and their own request');
{
  const monday = mondayAfter(40);
  const req = await api(admin, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: local(dayFrom(monday)), endDate: local(dayFrom(monday)),
    reason: 'Asked by the only approver',
  });
  rec(req.s === 201, 'the workspace\'s only approver asks for a day', brief(req));

  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await visit(page, '/leave', 7000);
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/only person who approves leave/i.test(body),
    'their request says it is theirs to decide, and why', body.slice(0, 300));
  const approve = page.getByRole('button', { name: 'Approve My Request' });
  const offered = await approve.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(offered, 'and offers the decision');
  if (offered) {
    await approve.click();
    // A decision about yourself is asked for once more.
    const asked = page.getByRole('alertdialog');
    rec(await asked.waitFor({ timeout: 5000 }).then(() => true, () => false), 'and asks before approving a request of its own');
    await asked.getByRole('button', { name: 'Approve' }).click().catch(() => {});
    await page.waitForTimeout(3000);
    const stored = (await api(admin, 'GET', `/leave_requests/${req.j?.id}`)).j;
    rec(stored?.status === 'APPROVED', 'which approves it', `status=${stored?.status}`);
  }
  await ctx.close();
}

const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const intern = await addRole(p.ws, 'DEVELOPER_INTERN', 'role.developer_intern@strata.local');
const [testerId, internId] = await Promise.all([tester, intern].map(whoami));

// ---- fixtures -------------------------------------------------------------------
// A colleague away on an ordinary working day soon.
const awayOffset = workingDayFrom(2);
const awayDay = dayFrom(awayOffset);
const away = await api(dev, 'POST', '/leave_requests', {
  workspaceId: p.ws, type: 'CASUAL', startDate: local(awayDay), endDate: local(awayDay),
  reason: 'A private reason nobody else should read',
});
await api(mgr, 'POST', `/leave_requests/${away.j?.id}/approve`, {});
// A holiday on the Wednesday of a week the tester will ask about.
const monday = mondayAfter(21);
const [weekStart, holidayDay, weekEnd] = [0, 2, 4].map((i) => local(dayFrom(monday + i)));
await api(mgr, 'POST', '/holidays', { workspaceId: p.ws, name: 'Midweek Holiday', date: holidayDay, isOptional: false });
// The tester checked in yesterday and is still at work.
const running = await api(mgr, 'POST', '/attendance', {
  workspaceId: p.ws, userId: testerId, date: local(dayFrom(-1)),
  checkInTime: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
});
// The intern forgot to check out three days ago.
const forgotten = dayFrom(-3);
forgotten.setHours(9, 0, 0, 0);
const open = await api(mgr, 'POST', '/attendance', {
  workspaceId: p.ws, userId: internId, date: local(forgotten), checkInTime: forgotten.toISOString(),
});
rec(away.s === 201 && running.s === 201 && open.s === 201, 'the fixtures exist',
  `${brief(away)} | ${brief(running)} | ${brief(open)}`);

// ---- somebody who does not approve leave ----------------------------------------
const { ctx, page, errors } = await signedInPage(browser, 'role.tester@strata.local', p.ws);

console.log('===== the calendar, for somebody who does not approve leave');
if (awayDay.getMonth() === new Date().getMonth()) {
  await visit(page, '/calendar', 8000);
  const cell = page.locator('button').filter({ hasText: new RegExp(`^${awayDay.getDate()}$`) }).first();
  rec((await cell.count()) > 0, `the ${awayDay.getDate()}th can be opened`);
  if (await cell.count()) {
    await cell.click();
    await page.waitForTimeout(2000);
    const panel = flat(await page.locator('main').innerText().catch(() => ''));
    rec(/1 person away/.test(panel), 'it says somebody is away',
      panel.slice(-400));
    rec(/SOFTWARE_DEVELOPER|Software Developer/i.test(panel), 'and who', panel.slice(-400));
    rec(!/casual/i.test(panel) && !/private reason/i.test(panel),
      'but not what kind of leave, or why', panel.slice(-400));
  }
} else {
  console.log('   the absence falls in next month — the calendar opens on this one; skipped');
}

console.log('===== the leave form');
await visit(page, '/leave', 7000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(!/only person who approves/i.test(body), 'nobody is told they are the only approver when they are not');
  await page.getByRole('button', { name: 'Request Leave' }).first().click();
  const dialog = page.getByRole('dialog');
  const start = dialog.locator('#startDate');
  const opened = await start.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(opened, 'the request form opens');
  if (opened) {
    // The form's dates are the app's DatePicker: the earliest day it offers is
    // the first day it does not grey out.
    const offered = (iso) => inPicker(page, start, async () => (await dayButton(page, iso)).isEnabled());
    const planned = { today: await offered(local(new Date())), dayBefore: await offered(local(dayFrom(-1))) };
    rec(planned.today && !planned.dayBefore,
      'planned leave starts today at the earliest', JSON.stringify(planned));

    await dialog.locator('#leaveType').click();
    await page.getByRole('option', { name: /sick/i }).first().click();
    await page.waitForTimeout(500);
    const sick = { monthBack: await offered(local(dayFrom(-30))), dayBefore: await offered(local(dayFrom(-31))) };
    rec(sick.monthBack && !sick.dayBefore,
      'sick leave can be dated up to thirty days back', JSON.stringify(sick));

    // A week with a declared holiday in the middle of it.
    await pickDate(page, start, weekStart);
    await pickDate(page, dialog.locator('#endDate'), weekEnd);
    await page.waitForTimeout(800);
    const text = flat(await dialog.innerText().catch(() => ''));
    rec(/for 4 working days/.test(text),
      'a week with a holiday in it is four working days, as the API will charge',
      text.slice(0, 400));
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

console.log('===== a shift that began yesterday');
await visit(page, '/attendance', 8000);
{
  const body = flat(await page.locator('main').innerText().catch(() => ''));
  rec(/checked in yesterday/i.test(body), 'the card says the shift from yesterday is still running',
    body.slice(0, 400));
  const checkOut = page.getByRole('button', { name: /^check out$/i }).first();
  const offered = await checkOut.waitFor({ timeout: 10000 }).then(() => true, () => false);
  rec(offered, 'and offers Check Out, not Check In',
    (await page.getByRole('button').allInnerTexts()).join(' | ').slice(0, 300));
  if (offered) {
    await checkOut.click();
    await page.getByRole('alertdialog').getByRole('button', { name: /check out/i }).click();
    await page.waitForTimeout(3000);
    const row = (await api(mgr, 'GET', `/attendance/${running.j?.id}`)).j;
    rec(Boolean(row?.checkOutTime) && row?.workHours > 4.9 && row?.workHours < 5.3,
      'which closes yesterday\'s row with the hours worked', JSON.stringify({ out: row?.checkOutTime, hours: row?.workHours }));
  }
}
await ctx.close();

console.log('===== a check-out that was forgotten');
{
  const mine = await signedInPage(browser, 'role.developer_intern@strata.local', p.ws);
  await visit(mine.page, '/attendance', 8000);
  const body = flat(await mine.page.locator('main').innerText().catch(() => ''));
  rec(/No check-out was recorded for/.test(body),
    'its owner is told, on the screen they check in from', body.slice(0, 400));
  // On a weekend the widget offers no Check In at all (by design: the day is
  // closed), so what "can still start today" means depends on the day it runs.
  // The app's working week (lib/utils/working-days.ts): Sundays are off, and so is
  // every Saturday except the month's 1st and 3rd. Treating every Saturday as a
  // weekend failed this on the first Saturday of November, a working day on which
  // the widget rightly offered Check In.
  const now = new Date();
  const nthSaturday = Math.floor((now.getDate() - 1) / 7) + 1;
  const weekend = now.getDay() === 0 || (now.getDay() === 6 && ![1, 3].includes(nthSaturday));
  rec(weekend ? /weekend/i.test(body) : /Check In/.test(body),
    weekend ? 'and today, a weekend, says so instead of offering a check-in' : 'and can still start today',
    body.slice(0, 300));
  await mine.ctx.close();

  const theirs = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(theirs.page, '/attendance?tab=team', 8000);
  await pickDate(theirs.page, theirs.page.locator('#team-attendance-day'), local(forgotten));
  await theirs.page.waitForTimeout(3500);
  const team = flat(await theirs.page.locator('main').innerText().catch(() => ''));
  rec(/No check-out recorded/.test(team),
    'and so is the manager who can correct it', team.slice(0, 500));
  await theirs.ctx.close();
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

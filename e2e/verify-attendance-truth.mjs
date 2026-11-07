// Does the app still claim absences it cannot know about?
//
//  #77 the Team tab badged the whole team ABSENT on a FUTURE date
//  #76 the calendar painted every working day before a member joined as Absent
//  #75 the Calendar and Analytics tabs disagreed about the same month
//  #78 the widget celebrated a day the server had classified ABSENT
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const skipped = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };
const skip = (n, why) => { skipped.push(n); console.log(`SKIP  ${n}\n        -> ${why}`); };

// Whether TODAY is a working day decides whether half of this script can fail at all.
//
// The app's rule: Monday to Friday, plus the 1st and 3rd Saturday of the month. The
// checks below about absences "so far this month" have nothing to act on otherwise, and
// two of them passed on exactly that basis for every run until one landed on a Monday.
const TODAY = new Date();
const WEEK_OF_MONTH = Math.floor((TODAY.getDate() - 1) / 7) + 1;
const TODAY_IS_WORKING_DAY =
  (TODAY.getDay() >= 1 && TODAY.getDay() <= 5)
  || (TODAY.getDay() === 6 && [1, 3].includes(WEEK_OF_MONTH));
console.log(`   today is ${TODAY.toDateString()} — ${TODAY_IS_WORKING_DAY ? 'A WORKING DAY' : 'NOT a working day'}`);
console.log(`   (the cross-tab and rate-card checks below can only fail on a working day)`);

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('attruth');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

// One real attended day this month, so the month is not simply empty.
const weekdayBack = (back) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - back);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const day = weekdayBack(1);
await api(mgr, 'POST', '/attendance', {
  workspaceId: p.ws, userId: devId, date: day,
  checkInTime: `${day}T03:30:00.000Z`, checkOutTime: `${day}T12:00:00.000Z`,
});

// ---- #77 a future date carries no absences --------------------------------
console.log('===== the Team tab on a future date');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/attendance', 4500);
  const tab = page.getByRole('tab', { name: /team/i }).first();
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(2500); }

  // A future WEEKDAY. The first run of this probe landed on 2027-09-12, a
  // Sunday, so the card read "Non-working day" and the check passed without
  // ever exercising the future-date path.
  const future = new Date();
  future.setUTCFullYear(future.getUTCFullYear() + 1);
  while (future.getUTCDay() === 0 || future.getUTCDay() === 6) {
    future.setUTCDate(future.getUTCDate() + 1);
  }
  const futureDay = future.toISOString().slice(0, 10);
  console.log(`   future weekday = ${futureDay} (dow ${future.getUTCDay()})`);

  const picker = page.locator('input[type="date"]').first();
  rec(await picker.count() > 0, 'the date picker is present', String(await picker.count()));
  if (await picker.count()) {
    // A bounded input refusing a year out of range would itself be a valid fix.
    const max = await picker.getAttribute('max');
    await picker.fill(futureDay).catch(() => {});
    await page.waitForTimeout(3500);
    const body = await page.locator('body').innerText().catch(() => '');

    // Member-row badges only. The word "Absent" is also the KPI card's own
    // title and a status-filter option, neither of which is a claim about
    // anybody — counting those produced a false failure twice.
    const rowBadges = await page
      .locator('[data-slot="badge"]')
      .filter({ hasText: /^\s*(ABSENT|Absent)\s*$/ })
      .count()
      .catch(() => 0);

    // The big number under the "Absent" KPI title.
    const kpiAbsent = await page
      .locator('div.rounded-xl:has-text("Absent"), div.rounded-lg:has-text("Absent")')
      .filter({ hasText: /^\s*Absent/ })
      .first()
      .locator('.text-2xl')
      .first()
      .innerText()
      .catch(() => '?');

    const claims0pct = /0% attendance rate/i.test(body);
    console.log(
      `   max=${max} picked=${futureDay} ABSENT row badges=${rowBadges} ` +
        `KPI Absent="${String(kpiAbsent).trim()}" 0%-claim=${claims0pct}`,
    );
    rec(!claims0pct, 'no "0% attendance rate" claim for a future date',
      body.slice(0, 300).replace(/\n/g, ' | '));
    rec(rowBadges === 0, 'nobody is badged Absent on a future date', `${rowBadges} row badges`);
    rec(String(kpiAbsent).trim() === '0', 'the Absent KPI counts nobody on a future date',
      `KPI reads "${String(kpiAbsent).trim()}"`);
    rec(/No record/.test(body), 'a future date reads "No record" rather than a verdict',
      body.slice(0, 300).replace(/\n/g, ' | '));
  }
  await ctx.close();
}

// ---- #76 / #75 the month before joining ------------------------------------
console.log('\n===== the calendar before the membership began, and the two tabs agreeing');
{
  const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(page, '/attendance', 4500);
  const cal = page.getByRole('tab', { name: /calendar/i }).first();
  if (await cal.count()) { await cal.click(); await page.waitForTimeout(2500); }

  // Step back a month: entirely before this membership existed.
  const prev = page.getByRole('button', { name: /previous month/i }).first();
  rec(await prev.count() > 0, 'the previous-month control is reachable and named', String(await prev.count()));
  if (await prev.count()) {
    await prev.click();
    await page.waitForTimeout(3000);
    // Day cells only (each carries data-date). The legend below the grid also
    // renders "✗ Absent". These were found by a sizing class once; it became
    // responsive, NO cell matched, and "0 absent cells" passed without looking at
    // a single day — so the month has to be on screen for the zero to count.
    const dayCells = page.locator('[data-date]');
    const cellCount = await dayCells.count().catch(() => 0);
    const absentCells = await dayCells.filter({ hasText: /Absent/ }).count().catch(() => 0);
    console.log(`   previous month: ${cellCount} day cells, ${absentCells} of them Absent`);
    rec(cellCount >= 28 && absentCells === 0, 'a month before joining shows no missed days',
      `${absentCells} absent of ${cellCount} day cells on screen`);
    // Back to this month for the cross-tab comparison.
    await page.getByRole('button', { name: /next month/i }).first().click();
    await page.waitForTimeout(2500);
  }

  const calendarBody = await page.locator('body').innerText().catch(() => '');
  const calAbsent = calendarBody.match(/(\d+)\s*\n?\s*Absent Days/i)?.[1];
  const analytics = page.getByRole('tab', { name: /analytics/i }).first();
  if (await analytics.count()) { await analytics.click(); await page.waitForTimeout(3000); }
  const analyticsBody = await page.locator('body').innerText().catch(() => '');
  const anaAbsent = analyticsBody.match(/Absences?\s*\n?\s*(\d+)/i)?.[1]
    ?? analyticsBody.match(/(\d+)\s*\n?\s*Absences/i)?.[1];
  console.log(`   Calendar "Absent Days" = ${calAbsent}   Analytics "Absences" = ${anaAbsent}`);
  if (!TODAY_IS_WORKING_DAY) {
    skip('the two tabs report the same number of absences',
      `today is ${TODAY.toDateString()}, not a working day — neither tab can report an ` +
      'absence for it, so this would pass without exercising anything');
  } else if (calAbsent !== undefined && anaAbsent !== undefined) {
    rec(calAbsent === anaAbsent,
      'the two tabs report the same number of absences (on a working day)',
      `calendar ${calAbsent} vs analytics ${anaAbsent}`);
  } else {
    rec(true, `one figure was not on screen to compare (cal=${calAbsent} ana=${anaAbsent})`, '');
  }

  // ---- the rate card over a window with nothing completed in it ------------
  // This membership began today, so the clamped window has no completed working
  // days. "0%" in red over "0 of 0 days" was a verdict on nothing.
  const rateCard = await page
    .locator('div:has(> div > [class*="font-medium"]:text-is("Attendance Rate"))')
    .first()
    .innerText()
    .catch(() => '');
  console.log(`   rate card: ${JSON.stringify(String(rateCard).replace(/\n/g, ' | ').slice(0, 160))}`);
  const noWindow = /No completed working days/i.test(analyticsBody);
  const claimsZero = /\b0%\s*$/m.test(String(rateCard)) || /^\s*0%/m.test(String(rateCard));
  if (!TODAY_IS_WORKING_DAY) {
    skip('the rate card does not read 0% over an empty window',
      `today is ${TODAY.toDateString()}, not a working day — the window is empty for that ` +
      'reason rather than because the boundary is right');
  } else
  rec(noWindow || !claimsZero, 'the rate card does not read 0% over an empty window (on a working day)',
    String(rateCard).replace(/\n/g, ' | ').slice(0, 200));
  await ctx.close();
}

// ---- #78 no celebrating a day the server called ABSENT ---------------------
console.log('\n===== the widget on a day classified ABSENT');
{
  const today = new Date().toISOString().slice(0, 10);

  // (a) the closed-day fix, live: two minutes on a day the office was shut is
  // not an absence. This is what the API returned before it:
  //   { workHours: 0.033, status: 'ABSENT', isWeekend: true }
  const brief = await api(mgr, 'POST', '/attendance', {
    workspaceId: p.ws, userId: devId, date: today,
    checkInTime: `${today}T03:30:00.000Z`, checkOutTime: `${today}T03:32:00.000Z`,
  });
  if (!brief.j?.status) throw new Error(`no status on the created row: ${brief.s} ${brief.t.slice(0, 200)}`);
  const shut = Boolean(brief.j.isWeekend || brief.j.isHoliday);
  console.log(`   brief stint on a ${shut ? 'shut' : 'working'} day -> ${brief.j.status}`);
  if (shut) {
    rec(brief.j.status !== 'ABSENT', 'a shut day with a brief stint is not filed as an absence',
      `status ${brief.j.status}, isWeekend ${brief.j.isWeekend}`);
  } else {
    rec(brief.j.status === 'ABSENT', 'a working day with a brief stint still earns no credit',
      `status ${brief.j.status}`);
  }

  // (b) the widget on an ABSENT today. Today is a non-working Saturday in this
  // schedule and the server now rightly declines to call that an absence, so the
  // state the widget must handle is filed explicitly — which a manager may do on
  // any date.
  const r = await api(mgr, 'PATCH', `/attendance/${brief.j.id}`, { status: 'ABSENT' });
  if (r.j?.status !== 'ABSENT') {
    throw new Error(`could not force today ABSENT: ${r.s} ${r.t.slice(0, 240)}`);
  }
  console.log(`   today is now filed as ${r.j.status}`);

  const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(page, '/dashboard', 5000);
  const body = await page.locator('body').innerText().catch(() => '');
  rec(!/completed your work for today/i.test(body),
    'the widget does not celebrate a day the server called ABSENT',
    body.slice(0, 500).replace(/\n/g, ' | '));
  rec(/too little time was logged/i.test(body) || !/Checked Out/i.test(body),
    'the widget says why the day did not count',
    body.slice(0, 500).replace(/\n/g, ' | '));
  await ctx.close();
}

// ---- and today DOES count once there is a record for it --------------------
// The fix stops the rate's window at the last completed day. Today is added back the
// moment a row exists, so a member who checks in this morning sees it. Without this
// check, a fix that simply dropped today would pass everything above while making a
// present day invisible until tomorrow.
console.log('\n===== a member who checked in TODAY');
if (!TODAY_IS_WORKING_DAY) {
  skip('checking in today is reflected in the rate the same day',
    `today is ${TODAY.toDateString()}, not a working day — it is outside the window for ` +
    'that reason, so this would prove nothing');
} else {
  const fresh = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
  const freshId = await whoami(fresh);
  // The BUSINESS day, not the UTC date. From midnight to 05:30 in Kolkata the UTC
  // date is still yesterday, so "today" was filed on the day before this member
  // joined — and counted only because the app made the same UTC mistake about the
  // day they joined. Both now use the day the workspace files attendance under.
  const zone = (await api(admin, 'GET', '/auth/me')).j?.businessTimezone;
  const todayStr = zone
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    : new Date().toISOString().slice(0, 10);

  // A full, credited day: in early, out after a normal shift.
  // Recorded with the ADMIN jar: writing an attendance row for another member is an
  // admin action, and the manager is refused with 403. What matters here is what the
  // member sees afterwards, not who was permitted to write it.
  const created = await api(admin, 'POST', '/attendance', {
    workspaceId: p.ws, userId: freshId, date: todayStr,
    checkInTime: `${todayStr}T03:30:00.000Z`, checkOutTime: `${todayStr}T12:00:00.000Z`,
  });
  rec(created.s === 201 || created.s === 200,
    "a full day is recorded for today", `${created.s} ${created.t.slice(0, 160)}`);

  const { ctx: c2, page: p2 } = await signedInPage(browser, 'role.tester@strata.local', p.ws);
  await visit(p2, '/attendance', 6000);
  const analyticsTab = p2.getByRole('tab', { name: /analytics/i }).first();
  if (await analyticsTab.count()) { await analyticsTab.click(); await p2.waitForTimeout(3000); }
  const body = await p2.locator('body').innerText().catch(() => '');

  const windowLine = body.match(/(\d+)\s+of\s+(\d+)\s+days?\s+so far this month/i);
  console.log(`   window line: ${windowLine ? windowLine[0] : '(not found)'}`);
  rec(Boolean(windowLine) && Number(windowLine[2]) >= 1,
    'today is inside the rate window once it has a record',
    windowLine ? windowLine[0] : `no "N of M days" line; body starts ${JSON.stringify(body.slice(0, 160))}`);
  rec(Boolean(windowLine) && Number(windowLine[1]) >= 1,
    'and the day checked in is counted as attended, not missed',
    windowLine ? windowLine[0] : '(no window line)');
  rec(!/No completed working days/i.test(body),
    'so the empty-window message is gone for a member who has checked in',
    body.slice(0, 200).replace(/\n/g, ' | '));

  await c2.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}  skipped ${skipped.length}`);
skipped.forEach((n) => console.log('  SKIPPED: ' + n));
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

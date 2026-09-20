// Do the browser and the server agree which day it is?
//
// The API stamps an attendance row with `todayUtc()`, which reads the SERVER's local
// calendar parts (getFullYear/getMonth/getDate) and wraps them as a UTC midnight marker.
// The comment above it explains the intent: a day MARKER rather than an instant, so a
// 01:00 check-in files under the day the employee is actually working.
//
// The frontend decides "today" separately, with `getCurrentDate()` -> `todayDateOnly()`
// -> the BROWSER's local date. The calendar paints today from that, and the rate window
// ends on it.
//
// Those two agree only while the employee and the server share a timezone. This checks
// what happens when they do not — a remote worker, or anyone travelling — by driving the
// browser in a deliberately distant zone and comparing the day the UI calls today against
// the day the row is actually filed under.
//
// This is adjacent to the bug fixed earlier today (the rate counting today as already
// missed), and the same class: a date decided in two places by two clocks.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 360)}`); };
const skipped = [];
const skip = (n, why) => { skipped.push(n); console.log(`SKIP  ${n}\n        -> ${why}`); };

const browser = await chromium.launch();
const p = await provision('tzday');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
void (await whoami(mgr));

// Zones chosen to straddle the server's day in both directions: +14 is the earliest
// calendar on earth, -11 the latest, so one of them is on a different date from the
// server at almost every instant.
const ZONES = [
  // Straddling the server's day in both directions: +14 is the earliest calendar on
  // earth, -11 the latest, so at almost any instant one of them is on a different date
  // from the server. The third is the server's own region, as the control.
  //
  // Existing accounts rather than fresh ones: registration is throttled to 3/hour
  // (THROTTLE_REGISTER_LIMIT), so minting an address per zone returns 400 with no
  // cookies. The workspace is freshly provisioned and attendance is workspace-scoped, so
  // reuse cannot drag in rows from another run.
  { id: 'Pacific/Kiritimati', label: 'UTC+14 (Line Islands)', email: 'role.software_developer@strata.local' },
  { id: 'Pacific/Midway', label: 'UTC-11 (Midway)', email: 'role.tester@strata.local' },
  { id: 'Asia/Kolkata', label: "UTC+5:30 (the server's own region)", email: 'role.content_engineer@strata.local' },
];

// The zone the API says it files days in. Everything below is asserted against this
// rather than against whichever clock the browser happens to carry.
const meResponse = await api(mgr, 'GET', '/auth/me');
const BUSINESS_TZ = meResponse.j?.businessTimezone;
const todayInBusinessZone = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const serverDate = () => new Date().toISOString().slice(0, 10);
rec(Boolean(BUSINESS_TZ),
  'the API reports the timezone it files days in, so the browser can agree with it',
  `/auth/me businessTimezone=${JSON.stringify(BUSINESS_TZ)}`);
console.log(`   business timezone: ${BUSINESS_TZ} — today there is ${todayInBusinessZone()}`);
console.log(`   this host's UTC date: ${serverDate()}`);
console.log(`   this host's local date: ${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);

for (const zone of ZONES) {
  console.log(`\n===== a member whose browser is in ${zone.label}`);

  // One existing account per zone: one person, one check-in, one day.
  const { email } = zone;
  const member = await addRole(p.ws, 'SOFTWARE_DEVELOPER', email);
  const memberId = await whoami(member);

  const { ctx, page } = await signedInPage(browser, email, p.ws, {
    contextOptions: { timezoneId: zone.id },
  });

  await visit(page, '/attendance', 8000);

  // What does the BROWSER think today is?
  const browserToday = await page.evaluate(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      offsetMinutes: -d.getTimezoneOffset(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  });
  console.log(`   browser zone=${browserToday.zone} offset=${browserToday.offsetMinutes}min  today=${browserToday.date}`);

  // The widget withholds Check In at the WEEKEND — correctly; the office is shut. Which
  // weekend depends on the browser's own calendar, and these three zones straddle the
  // date line, so one can be on Monday while another is still on Saturday. Asking the
  // browser is therefore the only answer that matches what the widget decided.
  //
  // Skipped loudly rather than asserted away: run on a Sunday, this script reported three
  // failures against an app behaving exactly as designed. A check that cannot run today
  // has to say so — one that quietly passes instead is worse than one that is red.
  const browserDay = await page.evaluate(() => new Date().getDay());
  if (browserDay === 0 || browserDay === 6) {
    skip(
      `${zone.label}: a check-in files under the day the browser is on`,
      `that browser's calendar reads ${browserDay === 0 ? 'Sunday' : 'Saturday'} ` +
        `(${browserToday.date}), and no Check In is offered at the weekend — there is no ` +
        'check-in to file, so nothing here can be measured today',
    );
    await ctx.close();
    continue;
  }

  // Check in through the UI, the way an employee would.
  const checkIn = page.getByRole('button', { name: /check in/i }).first();
  const hasButton = await checkIn.count() > 0;
  rec(hasButton, `${zone.label}: the attendance widget offers Check In`, String(await checkIn.count()));
  if (!hasButton) { await ctx.close(); continue; }

  await checkIn.click();
  await page.waitForTimeout(4000);

  // What date did the row actually get?
  const rows = await api(mgr, 'GET', `/attendance?workspaceId=${p.ws}&userId=${memberId}`);
  const mine = (rows.j?.items ?? []).filter((r) => r.userId === memberId);
  const filedDates = [...new Set(mine.map((r) => String(r.date).slice(0, 10)))];
  console.log(`   row(s) filed under: ${JSON.stringify(filedDates)}`);

  rec(filedDates.length === 1,
    `${zone.label}: exactly one attendance row exists after one check-in`,
    `${filedDates.length} distinct date(s): ${JSON.stringify(filedDates)} — ${mine.length} row(s)`);

  if (filedDates.length >= 1) {
    const filed = filedDates[0];
    const businessToday = todayInBusinessZone();
    const differsFromBrowser = businessToday !== browserToday.date;
    console.log(`   browser clock says ${browserToday.date}; business day is ${businessToday}; row filed under ${filed}`
      + `${differsFromBrowser ? '   <- the interesting case: browser and business day differ' : ''}`);
    rec(filed === businessToday,
      `${zone.label}: the row is filed under today IN THE BUSINESS ZONE`,
      `business day ${businessToday} vs filed ${filed}`);
  }

  // And does the calendar paint it on the day the employee sees as today?
  const calTab = page.getByRole('tab', { name: /calendar/i }).first();
  if (await calTab.count()) {
    await calTab.click();
    await page.waitForTimeout(3000);
    // Looked up by the BUSINESS day. Before the fix the calendar painted its "today"
    // from the browser's clock, so for a member outside the server's zone the attendance
    // landed on a cell they never looked at.
    const todayCell = await page.evaluate((todayDate) => {
      const day = Number(todayDate.slice(8, 10));
      const cells = Array.from(document.querySelectorAll('div.min-h-\\[80px\\]'));
      const cell = cells.find((c) => {
        const n = c.querySelector('span.font-semibold');
        return n && Number((n.textContent || '').trim()) === day;
      });
      return cell ? (cell.innerText || '').replace(/\n/g, ' | ').slice(0, 90) : null;
    }, todayInBusinessZone());
    console.log(`   calendar cell for the business day: ${JSON.stringify(todayCell)}`);
    rec(todayCell !== null && /Present|Late|✓|⏰/i.test(String(todayCell)),
      `${zone.label}: the calendar shows the check-in on the business day`,
      `${String(todayCell)} — the attendance must appear on the day the app calls today`);
  }

  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(
  `\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}` +
    `  skipped ${skipped.length}`,
);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
skipped.forEach((n) => console.log('  SKIPPED: ' + n));
if (skipped.length === ZONES.length) {
  // Worth saying out loud. A weekend everywhere means the only thing this script exists
  // to measure — where a check-in gets filed — was not exercised at all, and the row of
  // green above covers only the business-timezone lookup.
  console.log('\n  Every zone was on a weekend, so no check-in was filed or measured today.');
}

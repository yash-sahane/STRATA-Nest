// Leave and attendance keep to one set of rules, whoever asks and whenever the
// calendar changes.
//
//  - The holiday calendar applied only to what was written AFTER it. A holiday
//    declared inside leave that was already approved still cost the day, left a
//    marker saying the person was on leave on a day the office was shut, and
//    the screen told the manager to "adjust the balance if it should not".
//
//  - The leave form refused every past date and the API accepted any. Nobody
//    could record through the screen that they had been ill yesterday.
//
//  - The team calendar was built on the personal leave list, so for everybody
//    who does not approve leave it announced "0 people away".
//
//  - In a workspace with one approver, that person's own request could never
//    be decided.
//
//  - Attendance knew nothing of half-day leave (an afternoon arrival was hours
//    "late"), and check-out looked only for a row dated today — so a shift
//    still running at midnight could not be closed, and a forgotten check-out
//    disappeared from view.
//
//  API only: nothing here opens a page.
import { api, adminJar, provision, addRole, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 240)}`;

const admin = await adminJar();
const p = await provision('hrrules');
const adminId = await whoami(admin);

const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
const isWorking = (d) => {
  const day = d.getDay();
  if (day === 0) return false;
  if (day !== 6) return true;
  // Saturdays of the 1st and 3rd week are worked — the rule the API applies.
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return [1, 3].includes(Math.ceil((d.getDate() + first) / 7));
};
/** Three consecutive weekdays (Mon–Wed) at least `after` days out. */
const mondayAfter = (after) => {
  for (let i = after; i < after + 14; i += 1) if (dayFrom(i).getDay() === 1) return i;
  throw new Error('no Monday within a fortnight');
};
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

// ---- one approver, to begin with ----------------------------------------------
console.log('===== the only approver decides their own leave');
{
  const who = list((await api(admin, 'GET', `/leave_requests/approvers?workspaceId=${p.ws}`)).j);
  console.log(`   approvers before anybody is added: ${JSON.stringify(who)}`);
  rec(who.every((a) => a.userId === adminId),
    'nobody but the workspace\'s creator can approve leave yet', JSON.stringify(who));
  const monday = mondayAfter(40);
  const req = await api(admin, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: local(dayFrom(monday)), endDate: local(dayFrom(monday)),
    reason: 'The only approver, asking',
  });
  rec(req.s === 201, 'they ask for a day', brief(req));
  const decided = await api(admin, 'POST', `/leave_requests/${req.j?.id}/approve`, {});
  rec(decided.j?.status === 'APPROVED',
    'and can decide it, because nobody else here can', brief(decided));
}

const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const intern = await addRole(p.ws, 'DEVELOPER_INTERN', 'role.developer_intern@strata.local');
const [mgrId, devId, testerId, internId] = await Promise.all([mgr, dev, tester, intern].map(whoami));

{
  const who = list((await api(dev, 'GET', `/leave_requests/approvers?workspaceId=${p.ws}`)).j);
  rec(who.some((a) => a.userId === mgrId && a.name),
    'any member can see who decides leave here, by name', JSON.stringify(who));
  const monday = mondayAfter(47);
  const req = await api(mgr, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: local(dayFrom(monday)), endDate: local(dayFrom(monday)),
    reason: 'A manager, asking',
  });
  const own = await api(mgr, 'POST', `/leave_requests/${req.j?.id}/approve`, {});
  rec(own.s === 403 && /your own/i.test(own.t),
    'with a second approver present, nobody approves their own', brief(own));
}

// ---- when leave may start -----------------------------------------------------
console.log('===== when leave may start');
{
  // The most recent working day before today.
  let back = -1;
  while (!isWorking(dayFrom(back))) back -= 1;
  const past = local(dayFrom(back));
  const planned = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: past, endDate: past, reason: 'Already gone',
  });
  rec(planned.s === 400 && /before it starts/i.test(planned.t),
    'planned leave cannot start in the past', brief(planned));
  const sick = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'SICK', startDate: past, endDate: past, reason: 'Was ill',
  });
  rec(sick.s === 201, 'being ill yesterday can be recorded today', brief(sick));
  await api(dev, 'POST', `/leave_requests/${sick.j?.id}/cancel`, {});
  let far = -45;
  while (!isWorking(dayFrom(far))) far -= 1;
  const old = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'SICK', startDate: local(dayFrom(far)), endDate: local(dayFrom(far)), reason: 'Long ago',
  });
  rec(old.s === 400 && /30 days after the fact/i.test(old.t),
    'but not from six weeks ago', brief(old));
}

// ---- a holiday declared inside approved leave ---------------------------------
console.log('===== the calendar changes, and what is on record follows');
const monday = mondayAfter(14);
const [mon, tue, wed] = [0, 1, 2].map((i) => local(dayFrom(monday + i)));
const balanceOf = async (jar) => (await api(jar, 'GET', `/leave_balances/me?workspaceId=${p.ws}&year=${mon.slice(0, 4)}`)).j;
const before = await balanceOf(dev);
const leave = await api(dev, 'POST', '/leave_requests', {
  workspaceId: p.ws, type: 'CASUAL', startDate: mon, endDate: wed, reason: 'Three days away',
});
rec(leave.s === 201 && leave.j?.daysCount === 3, 'three days of leave are requested', brief(leave));
{
  const r = await api(mgr, 'POST', `/leave_requests/${leave.j?.id}/approve`, {});
  rec(r.j?.status === 'APPROVED', 'and approved', brief(r));
  rec((await balanceOf(dev))?.paidLeave === before.paidLeave - 3,
    'three days are charged', `${before.paidLeave} -> ${(await balanceOf(dev))?.paidLeave}`);
}
// A second person asks for the same days and is NOT yet decided.
const waiting = await api(tester, 'POST', '/leave_requests', {
  workspaceId: p.ws, type: 'CASUAL', startDate: mon, endDate: wed, reason: 'Waiting for an answer',
});
const markersOn = async (date, userId) =>
  list((await api(mgr, 'GET', `/attendance?workspaceId=${p.ws}&userId=${userId}&date=${date}`)).j)
    .filter((row) => row.status === 'ON_LEAVE');

rec((await markersOn(tue, devId)).length === 1, 'the Tuesday is marked as a day on leave');

const holiday = await api(mgr, 'POST', '/holidays', {
  workspaceId: p.ws, name: 'Founders Day', date: tue, isOptional: false,
});
rec(holiday.s === 201, 'the Tuesday is then declared a holiday', brief(holiday));
{
  const said = holiday.j?.reconciled;
  console.log(`   the API says: ${JSON.stringify(said)}`);
  rec(said?.leaveRequests === 2 && said?.daysReturned === 1,
    'and the answer says what that changed: two requests re-counted, one day returned',
    JSON.stringify(said));
  const mine = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
  rec(mine?.daysCount === 2, 'the approved leave is two days now', `daysCount=${mine?.daysCount}`);
  rec((await balanceOf(dev))?.paidLeave === before.paidLeave - 2,
    'the day is back on the balance — nobody has to adjust it by hand',
    `${before.paidLeave} at the start, ${(await balanceOf(dev))?.paidLeave} now`);
  rec((await markersOn(tue, devId)).length === 0, 'nobody is "on leave" on a day the office is shut');
  rec((await markersOn(mon, devId)).length === 1 && (await markersOn(wed, devId)).length === 1,
    'the days either side are still leave');
  const pending = (await api(tester, 'GET', `/leave_requests/${waiting.j?.id}`)).j;
  rec(pending?.daysCount === 2 && pending?.status === 'PENDING',
    'the request still waiting is re-counted too, and still waiting', `daysCount=${pending?.daysCount}`);
}
{
  const gone = await api(mgr, 'DELETE', `/holidays/${holiday.j?.id}`);
  rec([200, 204].includes(gone.s), 'the holiday is withdrawn again', brief(gone));
  const mine = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
  rec(mine?.daysCount === 3 && (await balanceOf(dev))?.paidLeave === before.paidLeave - 3,
    'and everything is as it was: three days, three charged',
    `daysCount=${mine?.daysCount} balance=${(await balanceOf(dev))?.paidLeave}`);
  rec((await markersOn(tue, devId)).length === 1, 'with the Tuesday a day on leave once more');
}

// ---- who is away ----------------------------------------------------------------
console.log('===== who is away is for everybody; why is not');
{
  const own = list((await api(intern, 'GET', `/leave_requests?workspaceId=${p.ws}`)).j);
  rec(own.every((r) => r.userId === internId),
    'somebody who does not approve leave still sees only their own requests', `${own.length} rows`);
  const away = list((await api(intern, 'GET', `/leave_requests/away?workspaceId=${p.ws}&from=${mon}&to=${wed}`)).j);
  const row = away.find((r) => r.userId === devId);
  rec(Boolean(row) && row.startDate === mon && row.endDate === wed && Boolean(row.userName),
    'but can see that a colleague is away, and until when', JSON.stringify(away));
  rec(Boolean(row) && !('type' in row) && !('reason' in row),
    'without the kind of leave or the reason for it', JSON.stringify(row));
  rec(!away.some((r) => r.userId === testerId),
    'a request nobody has agreed to is not an absence', JSON.stringify(away.map((r) => r.userId)));
}

// ---- half-day leave ---------------------------------------------------------------
console.log('===== a day with half of it on leave');
if (isWorking(new Date())) {
  const today = local(new Date());
  const half = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'HALF_DAY', startDate: today, endDate: today, reason: 'Morning off',
  });
  const ok = await api(mgr, 'POST', `/leave_requests/${half.j?.id}/approve`, {});
  rec(ok.j?.status === 'APPROVED', 'half a day of leave is approved for today', `${brief(half)} | ${brief(ok)}`);
  const arrived = await api(dev, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(arrived.s < 300 && arrived.j?.status === 'HALF_DAY' && arrived.j?.lateMinutes === 0,
    'arriving on it is a half day, and is not "late" at any hour', brief(arrived));
  const left = await api(dev, 'POST', '/attendance/check-out', { workspaceId: p.ws });
  rec(left.s < 300 && left.j?.status === 'HALF_DAY',
    'and it closes as a half day', brief(left));
} else {
  console.log('   today is not a working day here — half-day leave cannot be requested for it; skipped');
}

// ---- a shift that crosses midnight, and a check-out that was forgotten --------
console.log('===== a shift still running when the day turns over');
{
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const filed = await api(mgr, 'POST', '/attendance', {
    workspaceId: p.ws, userId: testerId, date: local(dayFrom(-1)), checkInTime: sixHoursAgo,
  });
  rec(filed.s === 201 && !filed.j?.checkOutTime, 'somebody checked in yesterday and is still at work', brief(filed));
  const standing = (await api(tester, 'GET', `/attendance/current?workspaceId=${p.ws}`)).j;
  rec(standing?.continuing === true && standing?.record?.id === filed.j?.id,
    'asked where they stand, the API says: in that shift', JSON.stringify(standing).slice(0, 240));
  const again = await api(tester, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(again.s === 400 && /still checked in from yesterday/i.test(again.t),
    'a new day cannot be started on top of it', brief(again));
  const closed = await api(tester, 'POST', '/attendance/check-out', { workspaceId: p.ws });
  rec(closed.s < 300 && closed.j?.id === filed.j?.id && closed.j?.workHours > 5.9 && closed.j?.workHours < 6.2,
    'check-out closes it — six hours, on the day it began', brief(closed));
}
console.log('===== a check-out that was simply forgotten');
{
  const then = dayFrom(-3);
  then.setHours(9, 0, 0, 0);
  const filed = await api(mgr, 'POST', '/attendance', {
    workspaceId: p.ws, userId: internId, date: local(then), checkInTime: then.toISOString(),
  });
  rec(filed.s === 201, 'a day three days ago was never checked out of', brief(filed));
  const standing = (await api(intern, 'GET', `/attendance/current?workspaceId=${p.ws}`)).j;
  rec(standing?.record === null && standing?.continuing === false && standing?.unclosed?.id === filed.j?.id,
    'the API points it out to its owner instead of losing sight of it', JSON.stringify(standing).slice(0, 260));
  const late = await api(intern, 'POST', '/attendance/check-out', { workspaceId: p.ws });
  rec(late.s === 400, 'it cannot be closed now — that would credit three days of "work"', brief(late));
  const today = await api(intern, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(today.s < 300, 'and it does not stop today from starting', brief(today));
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

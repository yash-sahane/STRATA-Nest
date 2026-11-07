// What has to stay true about who runs a workspace and what its calendar costs,
// checked against the running stack.
//
//  - Two managers demoting each other at the same moment cannot both win. They
//    were each checked against the workspace as it stood before the other's
//    write, so both passed and the workspace was left with nobody able to manage
//    it. Now the check and the write hold the workspace's administration lock.
//  - A workspace says which Saturdays it works (Settings -> Workspace). A change
//    applies from today: an approved leave across a Saturday that stops being
//    worked costs a day less, and the day comes back; put back, it is charged
//    again. A Saturday nobody works is not a day of leave.
//  - A holiday declared while somebody is asking for leave across it is counted
//    either way round: the leave and the holiday wait for each other under the
//    calendar lock, so the request never ends up charged for the holiday.
import { api, adminJar, provision, addRole, getJar, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t).slice(0, 200)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DAY = 24 * 60 * 60 * 1000;
const ymd = (d) => d.toISOString().slice(0, 10);
const utcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** 1-based week of the month, as the API reads a day (UTC parts). */
const weekOfMonth = (d) => {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay();
  return Math.ceil((d.getUTCDate() + first) / 7);
};
/** The first Saturday at least `after` days out that is the 1st or 3rd of its month. */
const workedSaturdayAfter = (after) => {
  const d = utcDay(new Date(Date.now() + after * DAY));
  while (!(d.getUTCDay() === 6 && [1, 3].includes(weekOfMonth(d)))) d.setTime(d.getTime() + DAY);
  return d;
};
/** The Monday at least `after` days out. */
const mondayAfter = (after) => {
  const d = utcDay(new Date(Date.now() + after * DAY));
  while (d.getUTCDay() !== 1) d.setTime(d.getTime() + DAY);
  return d;
};

const admin = await adminJar();
const cleanups = [];

try {
  // ---- two managers, demoting each other at once ---------------------------------------------
  console.log('===== two managers demoting each other at once');
  {
    // A workspace whose only two managers are the two in the race. Its owner is
    // somebody else, put on a role that manages nothing by a platform
    // administrator (the one who may repair an owner's role): an owner who is a
    // manager can never be demoted, so with one the race could not orphan it.
    const ownerEmail = 'role.manager@strata.local';
    const created = await api(admin, 'POST', '/workspaces', {
      name: 'QA managers race',
      description: 'deep-test scope for managers race',
      manager: { name: 'Race Owner', email: ownerEmail },
    });
    const ws = created.j?.id;
    rec(created.s === 201 && !!ws, 'a workspace is made for its owner', brief(created));
    if (ws) cleanups.push(() => api(admin, 'DELETE', `/workspaces/${ws}?cascade=true`));
    const ownerId = await whoami(await getJar(ownerEmail));
    const memberships = async () =>
      list((await api(admin, 'GET', `/workspace_members?workspaceId=${ws}&limit=100`)).j);
    const ownerRow = (await memberships()).find((m) => m.userId === ownerId);
    const benched = await api(admin, 'PATCH', `/workspace_members/${ownerRow?.id}`, { role: 'MEMBER' });
    rec(benched.s === 200, 'a platform administrator puts the owner on a role that manages nothing', brief(benched));

    const first = await addRole(ws, 'MANAGER', 'role.assistant_manager@strata.local');
    const second = await addRole(ws, 'MANAGER', 'role.software_developer@strata.local');
    const [firstId, secondId] = [await whoami(first), await whoami(second)];
    const rowOf = async (userId) => (await memberships()).find((m) => m.userId === userId);

    let alwaysOne = true;
    let neverOrphaned = true;
    const outcomes = [];
    for (let round = 1; round <= 3; round += 1) {
      const [a, b] = [await rowOf(firstId), await rowOf(secondId)];
      // Both managers again before each round.
      for (const row of [a, b]) {
        if (row && row.role !== 'MANAGER') await api(admin, 'PATCH', `/workspace_members/${row.id}`, { role: 'MANAGER' });
      }
      const [ra, rb] = await Promise.all([
        api(first, 'PATCH', `/workspace_members/${b?.id}`, { role: 'MEMBER' }),
        api(second, 'PATCH', `/workspace_members/${a?.id}`, { role: 'MEMBER' }),
      ]);
      const won = [ra, rb].filter((r) => r.s === 200).length;
      outcomes.push(`round ${round}: ${ra.s}/${rb.s}`);
      if (won !== 1) alwaysOne = false;
      const managersLeft = (await memberships()).filter(
        (m) => m.status === 'ACTIVE' && m.role === 'MANAGER',
      ).length;
      if (managersLeft < 1) neverOrphaned = false;
    }
    rec(alwaysOne, 'of the two demotions, exactly one lands — every round', outcomes.join(', '));
    rec(neverOrphaned, 'and the workspace always keeps a manager');
  }

  // ---- the working week ------------------------------------------------------------------
  console.log('===== a workspace works the Saturdays it says it works');
  const p = await provision('working week');
  cleanups.push(() => p.cleanup());
  const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
  const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
  {
    const saturday = workedSaturdayAfter(21);
    const friday = new Date(saturday.getTime() - DAY);
    const monday = new Date(saturday.getTime() + 2 * DAY);
    const year = friday.getUTCFullYear();
    const balance = async () => {
      const b = (await api(dev, 'GET', `/leave_balances/me?workspaceId=${p.ws}&year=${year}`)).j;
      return b?.paidLeave ?? list(b)[0]?.paidLeave;
    };
    const leave = await api(dev, 'POST', '/leave_requests', {
      workspaceId: p.ws, type: 'CASUAL', startDate: ymd(friday), endDate: ymd(monday), reason: 'a long weekend away',
    });
    rec(leave.s === 201 && leave.j?.daysCount === 3,
      `Friday to Monday across the ${weekOfMonth(saturday) === 1 ? '1st' : '3rd'} Saturday is three days — that Saturday is worked`,
      brief(leave));
    const approved = await api(mgr, 'POST', `/leave_requests/${leave.j?.id}/approve`, {});
    rec(approved.s < 300, 'approved', brief(approved));
    const afterApproval = await balance();

    const off = await api(mgr, 'PATCH', `/workspaces/${p.ws}`, { settings: { workingSaturdays: [] } });
    const history = off.j?.settings?.workingWeek ?? [];
    // The workspace's today, which is a day either side of UTC's for some hours of every day.
    const fromToday = history.length === 1 && Math.abs(Date.parse(history[0].from) - Date.parse(ymd(new Date()))) <= DAY;
    rec(off.s === 200 && fromToday && history[0].saturdays.length === 0,
      'no Saturday worked, from today — kept as a history', `${off.s} ${JSON.stringify(history)}`);
    rec((off.j?.reconciled?.leaveRequests ?? 0) >= 1,
      'and the leave across that Saturday is counted again', JSON.stringify(off.j?.reconciled));
    await sleep(500);
    const shorter = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
    const refunded = await balance();
    rec(shorter?.daysCount === 2, 'the leave is two days now', `daysCount=${shorter?.daysCount}`);
    rec(refunded === afterApproval + 1, 'and the Saturday comes back to the balance',
      `balance ${afterApproval} -> ${refunded}`);

    const saturdayOnly = await api(dev, 'POST', '/leave_requests', {
      workspaceId: p.ws, type: 'CASUAL', startDate: ymd(saturday), endDate: ymd(saturday), reason: 'only that saturday',
    });
    rec(saturdayOnly.s === 400 && /no working days/i.test(saturdayOnly.t),
      'a Saturday nobody works is not a day of leave', brief(saturdayOnly));

    const back = await api(mgr, 'PATCH', `/workspaces/${p.ws}`, { settings: { workingSaturdays: [1, 3] } });
    await sleep(500);
    const longer = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
    const recharged = await balance();
    rec(back.s === 200 && longer?.daysCount === 3, 'the 1st and 3rd back: three days again', `${back.s} daysCount=${longer?.daysCount}`);
    rec(recharged === afterApproval, 'and the Saturday is charged again', `balance ${refunded} -> ${recharged}`);

    const unchanged = await api(mgr, 'PATCH', `/workspaces/${p.ws}`, { settings: { workingSaturdays: [3, 1] } });
    rec(unchanged.s === 200 && !unchanged.j?.reconciled,
      'saving the same week again re-counts nothing', `${unchanged.s} reconciled=${JSON.stringify(unchanged.j?.reconciled)}`);

    const refused = await api(mgr, 'PATCH', `/workspaces/${p.ws}`, { settings: { workingSaturdays: [6] } });
    rec(refused.s === 400 && /weeks of the month/i.test(refused.t), 'a sixth Saturday is refused', brief(refused));

    const member = await api(dev, 'PATCH', `/workspaces/${p.ws}`, { settings: { workingSaturdays: [] } });
    rec(member.s === 403, 'and only somebody who may change the workspace can change its week', brief(member));

    await api(dev, 'POST', `/leave_requests/${leave.j?.id}/cancel`, {});
  }

  // ---- a holiday declared while leave is being asked for --------------------------------------
  console.log('===== a holiday declared while leave is asked for across it');
  {
    let alwaysCounted = true;
    const seen = [];
    for (let round = 0; round < 3; round += 1) {
      const monday = mondayAfter(35 + round * 7);
      const tuesday = new Date(monday.getTime() + DAY);
      const wednesday = new Date(monday.getTime() + 2 * DAY);
      const [leave, holiday] = await Promise.all([
        api(dev, 'POST', '/leave_requests', {
          workspaceId: p.ws, type: 'CASUAL', startDate: ymd(monday), endDate: ymd(wednesday), reason: 'three days away',
        }),
        api(mgr, 'POST', '/holidays', { workspaceId: p.ws, name: `Race day ${round + 1}`, date: ymd(tuesday), isOptional: false }),
      ]);
      await sleep(300);
      const stored = (await api(dev, 'GET', `/leave_requests/${leave.j?.id}`)).j;
      seen.push(`${leave.s}/${holiday.s} days=${stored?.daysCount}`);
      if (leave.s !== 201 || holiday.s !== 201 || stored?.daysCount !== 2) alwaysCounted = false;
      if (leave.j?.id) await api(dev, 'DELETE', `/leave_requests/${leave.j.id}`);
      if (holiday.j?.id) await api(mgr, 'DELETE', `/holidays/${holiday.j.id}`);
    }
    rec(alwaysCounted, 'whichever lands first, the leave is two days: the holiday is never charged', seen.join(', '));
  }
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
}

const rows = summary();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

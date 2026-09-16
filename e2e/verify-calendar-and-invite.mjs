// The calendar did not show who was away, and a lower-case invite code read as invalid.
//
//  /calendar loaded tasks and sprints and contained no reference to leave at all, in an
//    app with an approval queue, balances and an accrual model. Who is away is the
//    thing a team calendar is most often opened for.
//
//  Invite codes are GENERATED uppercase and were matched exactly, so transcribing one
//    from an e-mail in lower case — or pasting it with a stray space — answered
//    "Invalid invite code" for a code that exists.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, getJar, whoami, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('calinv');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');

const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

/**
 * The first WORKING day at or after `from` days out.
 *
 * Leave cannot be filed on a day nobody works, and the API says so plainly — "The selected
 * dates contain no working days". A fixed offset therefore fails roughly two days in seven,
 * depending only on when the suite runs. This is the same trap that let the attendance
 * checks pass "12/12" twice while landing on a Sunday.
 *
 * The rule is the app's own: Monday to Friday, plus the 1st and 3rd Saturday of the month.
 */
const workingDayFrom = (from) => {
  for (let d = from; d < from + 14; d += 1) {
    const x = new Date();
    x.setUTCDate(x.getUTCDate() + d);
    const day = x.getUTCDay();
    if (day >= 1 && day <= 5) return x.toISOString().slice(0, 10);
    if (day === 6) {
      const weekOfMonth = Math.floor((x.getUTCDate() - 1) / 7) + 1;
      if (weekOfMonth === 1 || weekOfMonth === 3) return x.toISOString().slice(0, 10);
    }
  }
  throw new Error('no working day found within a fortnight — check the working-day rule');
};

// ---- approved leave inside the current month --------------------------------
console.log('===== the calendar shows who is away');
{
  // Two days from now, so it sits in this month for all but the last days of it.
  const start = plus(2);
  const end = plus(3);
  const req = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: start, endDate: end,
    reason: 'Away for the calendar check',
  });
  rec(req.s === 201, 'a leave request exists', `${req.s} ${req.t.slice(0, 200)}`);
  const approved = await api(mgr, 'POST', `/leave_requests/${req.j?.id}/approve`, {});
  rec(approved.j?.status === 'APPROVED', 'and it is approved',
    `${approved.s} ${approved.t.slice(0, 200)}`);

  // A PENDING one must NOT appear: a request is not an absence.
  const pendingDay = workingDayFrom(10);
  const pending = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'SICK', startDate: pendingDay, endDate: pendingDay,
    reason: 'Pending, nobody has agreed to this',
  });
  // The BODY, not just the status: this failed as a bare `400` and the reason ("The
  // selected dates contain no working days") had to be dug out by hand.
  rec(pending.s === 201, 'and a second request is left pending',
    `${pending.s} on ${pendingDay}: ${pending.t.slice(0, 200)}`);

  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/calendar', 9000);

  const body = await page.locator('body').innerText().catch(() => '');
  rec(/Away/.test(body), 'the calendar has an "Away" legend', body.slice(0, 400).replace(/\n/g, ' | '));

  // Click the day the approved leave covers.
  const dayNumber = new Date(`${start}T00:00:00Z`).getUTCDate();
  const cell = page.locator('button').filter({ hasText: new RegExp(`^${dayNumber}$`) }).first();
  rec(await cell.count() > 0, `the day cell for the ${dayNumber}th is clickable`,
    String(await cell.count()));
  if (await cell.count()) {
    await cell.click();
    await page.waitForTimeout(2500);
    const panel = await page.locator('body').innerText().catch(() => '');
    console.log(`   day panel mentions away: ${/away/i.test(panel)}`);
    rec(/away/i.test(panel), 'the day panel reports somebody away',
      panel.slice(-500).replace(/\n/g, ' | '));
    rec(/Role SOFTWARE_DEVELOPER|casual/i.test(panel),
      'and says who, and what kind of leave',
      panel.slice(-500).replace(/\n/g, ' | '));
    rec(!/Pending, nobody has agreed/i.test(panel),
      'a PENDING request is not drawn as an absence',
      panel.slice(-500).replace(/\n/g, ' | '));
  }
  await ctx.close();
}

// ---- an invite code typed in the wrong case ---------------------------------
console.log('\n===== redeeming an invite code');
{
  const created = await api(admin, 'POST', '/invite_codes', {
    workspaceId: p.ws, role: 'MEMBER', maxUses: 10,
  });
  const code = created.j?.code;
  console.log(`   generated code: ${JSON.stringify(code)}`);
  rec(Boolean(code), 'an invite code was generated', `${created.s} ${created.t.slice(0, 200)}`);
  rec(code === String(code).toUpperCase(), 'and it is stored uppercase', String(code));

  // Somebody who is not yet a member of this workspace.
  const outsider = await getJar('role.tester@strata.local', 'RolePass123!');
  const before = await api(outsider, 'GET', '/workspaces');
  const had = (before.j?.items ?? []).some((w) => w.id === p.ws);
  rec(!had, 'the outsider is not a member yet', JSON.stringify((before.j?.items ?? []).map((w) => w.id)));

  // Lower case, with the sort of stray space a paste leaves behind.
  const typed = `  ${String(code).toLowerCase()} `;
  const joined = await api(outsider, 'POST', '/workspaces/accept-invitation', { code: typed });
  console.log(`   redeeming ${JSON.stringify(typed)} -> ${joined.s} ${joined.t.slice(0, 160)}`);
  rec(joined.s < 400 && joined.j?.success,
    'a lower-case, space-padded code is accepted',
    `${joined.s} ${joined.t.slice(0, 250)}`);
  rec(joined.j?.workspaceId === p.ws, 'and it joins the right workspace',
    String(joined.j?.workspaceId));

  // A genuinely wrong code must still be refused.
  const bogus = await api(outsider, 'POST', '/workspaces/accept-invitation', { code: 'NOTAREALCODE' });
  rec(bogus.s === 400, 'a code that does not exist is still refused',
    `${bogus.s} ${bogus.t.slice(0, 200)}`);
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

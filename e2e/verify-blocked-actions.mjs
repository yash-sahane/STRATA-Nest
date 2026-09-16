// Three things a user could not do that they should be able to.
//
//  a sprint that has already begun could not be recorded — the start-date picker
//    disabled every day before today, while the server accepts past starts
//  a PENDING leave request whose start date had passed could never be withdrawn,
//    by anyone, and stayed approvable
//  the Log Time task field said "(Optional)" and had no way back to "no task"
import { chromium, api, provision, addRole, signedInPage, visit, whoami, watchToasts, toasts } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('blocked');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

const dayOffset = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---- a PENDING request with a start date in the past ------------------------
console.log('===== withdrawing a pending request whose start has passed');
{
  // Submitted for days that have since gone by and never acted on.
  const past = dayOffset(-10);
  const pastEnd = dayOffset(-8);
  const req = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: past, endDate: pastEnd,
    reason: 'Submitted and then forgotten about',
  });
  console.log(`   create: ${req.s} status=${req.j?.status} start=${req.j?.startDate}`);
  rec(req.s === 201, 'a leave request can be filed for past dates', `${req.s} ${req.t.slice(0, 200)}`);
  rec(req.j?.status === 'PENDING', 'and it is PENDING', String(req.j?.status));

  const cancelled = await api(dev, 'POST', `/leave_requests/${req.j?.id}/cancel`, {});
  console.log(`   cancel: ${cancelled.s} -> ${cancelled.j?.status}`);
  rec(cancelled.s < 400, 'the requester CAN now withdraw it', `${cancelled.s} ${cancelled.t.slice(0, 250)}`);
  rec(cancelled.j?.status === 'CANCELLED', 'and it lands as CANCELLED', String(cancelled.j?.status));
}

// ---- an APPROVED request that has begun is still protected ------------------
console.log('\n===== but approved leave that has started is still protected');
{
  const past = dayOffset(-6);
  const req = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: past, endDate: dayOffset(-5),
    reason: 'Already taken',
  });
  const approved = await api(mgr, 'POST', `/leave_requests/${req.j?.id}/approve`, {});
  console.log(`   approve: ${approved.s} -> ${approved.j?.status}`);
  if (approved.j?.status === 'APPROVED') {
    const cancelled = await api(dev, 'POST', `/leave_requests/${req.j?.id}/cancel`, {});
    console.log(`   cancel an approved, started request: ${cancelled.s} ${cancelled.t.slice(0, 140)}`);
    rec(cancelled.s === 400 && /already started/i.test(cancelled.t),
      'approved leave that has already started cannot be un-taken',
      `${cancelled.s} ${cancelled.t.slice(0, 200)}`);
  } else {
    rec(false, 'the request could be approved for this check',
      `${approved.s} ${approved.t.slice(0, 200)}`);
  }
}

// ---- the sprint start-date picker ------------------------------------------
console.log('\n===== recording a sprint that has already begun');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/sprints', 6000);
  await watchToasts(page);

  const newSprint = page.getByRole('button', { name: /new sprint|create sprint/i }).first();
  rec(await newSprint.count() > 0, 'the New Sprint button is present', String(await newSprint.count()));
  await newSprint.click();
  // Wait for the dialog by its own heading, not by [role="dialog"].first() —
  // the page holds more than one dialog node and `.first()` picked a hidden one,
  // so a scoped lookup for the date button found nothing and then spent 30s
  // timing out as though the control were missing.
  await page.getByText('Create New Sprint').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  rec(await page.getByText('Create New Sprint').first().isVisible().catch(() => false),
    'the Create Sprint dialog opened', 'heading not visible');

  // Open the start-date calendar and look at what is disabled.
  const startBtn = page.getByRole('button', { name: /start date/i }).first();
  const found = await startBtn.count();
  if (found === 0) {
    // Say what IS on screen rather than timing out for 30s as if the control
    // were missing.
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)),
    );
    console.log(`   visible buttons: ${JSON.stringify(buttons)}`);
  }
  rec(found > 0, 'the start-date picker opens', String(found));
  if (found === 0) {
    await ctx.close();
    throw new Error('cannot continue without the start-date picker');
  }
  await startBtn.click();
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"] button, button[name="day"]')];
    const disabled = cells.filter((b) => b.disabled || b.getAttribute('aria-disabled') === 'true');
    // Yesterday's cell specifically: the one a team recording a running sprint
    // needs most.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const label = String(y.getDate());
    const yesterday = cells.find((b) => b.textContent?.trim() === label);
    return {
      cells: cells.length,
      disabled: disabled.length,
      yesterdayFound: Boolean(yesterday),
      yesterdayDisabled: yesterday
        ? Boolean(yesterday.disabled) || yesterday.getAttribute('aria-disabled') === 'true'
        : null,
    };
  });
  console.log(`   ${state.cells} day cells, ${state.disabled} disabled; yesterday disabled=${state.yesterdayDisabled}`);
  rec(state.cells > 0, 'the calendar rendered day cells', JSON.stringify(state));
  rec(state.yesterdayFound, 'yesterday is on screen', JSON.stringify(state));
  rec(state.yesterdayDisabled === false,
    'a past day can be chosen as the start of a sprint',
    JSON.stringify(state));
  await ctx.close();
}

// ---- the server accepts what the picker now offers --------------------------
console.log('\n===== the server agrees');
{
  const r = await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws, projectId: p.project, name: 'Already Running Sprint',
    goal: 'started last week', startDate: dayOffset(-7), endDate: dayOffset(7), status: 'ACTIVE',
  });
  console.log(`   sprint starting 7 days ago: ${r.s}`);
  rec(r.s === 201, 'a sprint starting in the past is accepted', `${r.s} ${r.t.slice(0, 200)}`);
}

// ---- the Log Time task can be un-chosen ------------------------------------
console.log('\n===== un-choosing a task in Log Time');
{
  const t = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'BLK-1',
    title: 'A task to pick and unpick', status: 'TODO', priority: 'MEDIUM', assigneeIds: [devId],
  });
  rec(Boolean(t.j?.id), 'a task exists to choose', `${t.s} ${t.t.slice(0, 160)}`);

  const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(page, '/time-tracking', 6000);
  const logBtn = page.getByRole('button', { name: /log time|add entry|manual/i }).first();
  rec(await logBtn.count() > 0, 'the Log Time control is reachable', String(await logBtn.count()));
  await logBtn.click();
  await page.waitForTimeout(2500);

  const trigger = page.locator('#task');
  rec(await trigger.count() > 0, 'the task field is present', String(await trigger.count()));
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1200);
    const options = await page.locator('[role="option"]').allInnerTexts();
    console.log(`   options: ${JSON.stringify(options)}`);
    rec(options.some((o) => /no task/i.test(o)),
      'an explicit "No task" option exists',
      JSON.stringify(options));

    // Pick the task, then put it back to none.
    const real = page.locator('[role="option"]').filter({ hasText: 'BLK-1' }).first();
    if (await real.count()) {
      await real.click();
      await page.waitForTimeout(1000);
      const chosen = await trigger.innerText().catch(() => '');
      console.log(`   after choosing: ${JSON.stringify(chosen.trim())}`);
      rec(/BLK-1/.test(chosen), 'the task can be chosen', chosen);

      await trigger.click();
      await page.waitForTimeout(1200);
      await page.locator('[role="option"]').filter({ hasText: /no task/i }).first().click();
      await page.waitForTimeout(1000);
      const after = await trigger.innerText().catch(() => '');
      console.log(`   after un-choosing: ${JSON.stringify(after.trim())}`);
      rec(!/BLK-1/.test(after),
        'and un-chosen again — the field is optional in fact, not only in its label',
        after);
    } else {
      rec(false, 'the task appeared as an option', JSON.stringify(options));
    }
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

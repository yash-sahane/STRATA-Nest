// "1 days", and a roster you cannot filter by.
//
//  Counts were interpolated into a hardcoded plural in a dozen places, so a single
//  item read "1 days" / "1 tasks, 1 sprints" / "1 members".
//
//  The Team tab built both filter dropdowns from ROLE_CONFIG / STATUS_CONFIG while
//  the table renders an unknown role through a fallback — so a member holding a
//  custom workspace role appeared on the roster with no way to filter by their role.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('plural');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// ---- exactly ONE of each thing, which is where the bug shows ----------------
console.log('===== one task and one sprint due today');
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Single Sprint',
  goal: 'one of each', startDate: today, endDate: plus(1), status: 'ACTIVE',
});
const t = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'PL-1',
  title: 'Single task', status: 'TODO', priority: 'HIGH',
  assigneeIds: [mgrId], dueDate: plus(1),
});
rec(Boolean(t.j?.id), 'one task exists, due tomorrow', `${t.s} ${t.t.slice(0, 160)}`);

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

// The dashboard's due badge: "1 day", never "1 days".
await visit(page, '/dashboard', 7000);
{
  const body = await page.locator('body').innerText().catch(() => '');
  const bad = body.match(/\b1 (days|tasks|sprints|members|entries|requirements)\b/g) ?? [];
  console.log(`   dashboard singular-plural slips: ${JSON.stringify(bad)}`);
  rec(bad.length === 0, 'the dashboard never says "1 days" or "1 tasks"', JSON.stringify(bad));
}

// The calendar's day summary.
await visit(page, '/calendar', 7000);
{
  const body = await page.locator('body').innerText().catch(() => '');
  const bad = body.match(/\b1 (days|tasks|sprints|members)\b/g) ?? [];
  console.log(`   calendar singular-plural slips: ${JSON.stringify(bad)}`);
  rec(bad.length === 0, 'the calendar never says "1 tasks, 1 sprints"', JSON.stringify(bad));
}

// Projects: a project with exactly one member.
await visit(page, '/projects', 7000);
{
  const body = await page.locator('body').innerText().catch(() => '');
  const bad = body.match(/\b1 members\b/g) ?? [];
  console.log(`   projects singular-plural slips: ${JSON.stringify(bad)}`);
  rec(bad.length === 0, 'a one-member project says "1 member"', JSON.stringify(bad));
}

// ---- the roster filter offers every role that is on it ----------------------
console.log('\n===== the Team tab filters');
{
  // A CUSTOM workspace role, ASSIGNED to somebody — creating it is not enough.
  // The first version of this only created the role, so the roster showed nothing
  // but "Manager" and the check passed without touching the case it exists for.
  const role = await api(admin, 'POST', '/workspace_roles', {
    workspaceId: p.ws, name: 'Release Captain', permissions: ['project:read'],
  });
  console.log(`   custom role: ${role.s} ${role.j?.id ?? role.t.slice(0, 140)}`);

  const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
  const testerId = await whoami(tester);
  const members = await api(admin, 'GET', `/workspace_members?workspaceId=${p.ws}&pageSize=100`);
  const testerRow = (members.j?.items ?? []).find((m) => m.userId === testerId);
  rec(Boolean(testerRow), 'a second member exists to give the custom role to',
    `${members.s} ${JSON.stringify((members.j?.items ?? []).map((m) => m.userId))}`);
  if (testerRow) {
    const assigned = await api(admin, 'PATCH', `/workspace_members/${testerRow.id}`, {
      role: 'Release Captain',
    });
    console.log(`   assigned the custom role: ${assigned.s} role=${assigned.j?.role}`);
    rec(assigned.s < 400 && assigned.j?.role === 'Release Captain',
      'the custom role is assigned to a member',
      `${assigned.s} ${assigned.t.slice(0, 200)}`);
  }

  await visit(page, '/team', 8000);
  const rosterRoles = await page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')].map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90)),
  );
  console.log(`   roster rows: ${JSON.stringify(rosterRoles.slice(0, 4))}`);

  // What state is this page actually in? Under load the API rate-limits (the whole suite
  // shares one `THROTTLE_DEFAULT_LIMIT` budget) and the page renders "We couldn't load
  // your team members … Try again" — correct behaviour, which a check hunting for a
  // filter would otherwise report as a missing control.
  const pageState = await page.evaluate(() => {
    const main = (document.querySelector('main')?.innerText || document.body.innerText || '');
    return {
      failedToLoad: /couldn't load|could not load|something went wrong|try again/i.test(main),
      rows: document.querySelectorAll('tbody tr').length,
      excerpt: main.trim().slice(0, 160).replace(/\n/g, ' | '),
    };
  });
  if (pageState.failedToLoad && pageState.rows === 0) {
    rec(false, 'the team roster loaded at all',
      `the page is showing its load-failure state, so the filter checks below cannot mean `
      + `anything — usually the API rate limiter under suite load, not a UI fault: `
      + `"${pageState.excerpt}"`);
  }

  // Every role word visible in the table must be offered by the picker.
  const trigger = page.getByRole('combobox', { name: /filter members by role/i }).first();
  rec(await trigger.count() > 0, 'the role filter is present', String(await trigger.count()));
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1200);
    const options = (await page.locator('[role="option"]').allInnerTexts()).map((o) => o.trim());
    console.log(`   role options: ${JSON.stringify(options)}`);
    rec(options.length > 1, 'it offers roles', JSON.stringify(options));

    // Each member's displayed role must be selectable.
    const displayed = await page.evaluate(() =>
      [...document.querySelectorAll('tbody tr')]
        .map((r) => r.querySelectorAll('td')[1]?.textContent?.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    console.log(`   roles shown in the table: ${JSON.stringify(displayed)}`);
    rec(displayed.includes('Release Captain'),
      'the roster reports the custom role, not "Member"',
      `shown: ${JSON.stringify(displayed)}`);
    rec(displayed.includes('Manager') && !displayed.includes('MANAGER'),
      'and a built-in role still reads "Manager", not the stored key "MANAGER"',
      `shown: ${JSON.stringify(displayed)}`);
    const dupes = options.filter((o) => o.toUpperCase() === 'MANAGER');
    rec(dupes.length === 1,
      'the options list carries one spelling of each role, not two',
      `manager-ish options: ${JSON.stringify(dupes)}`);
    const missing = displayed.filter((d) => !options.some((o) => o === d));
    rec(missing.length === 0,
      'every role shown on the roster can be picked in the filter',
      `not offered: ${JSON.stringify(missing)}; options: ${JSON.stringify(options)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // By position among the two filter comboboxes rather than by accessible name: the
  // first attempt looked for the name while the role listbox was still open and
  // capturing, found nothing, and then "passed" its options check against the role
  // list that was still on screen.
  // By its own aria-label attribute. Two earlier attempts went wrong here: the
  // accessible-name query found nothing while the role listbox was still open, and
  // nth(1) picked another combobox on the page — both then "passed" an options check
  // against the role list that was still on screen.
  const statusTrigger = page.locator('[aria-label="Filter members by status"]').first();

  // Polled, not asked once. Under full-suite load this control had not rendered when the
  // check looked, and the unguarded click below then waited out Playwright's default
  // timeout and killed the process — turning a slow render into `0/0, no tally found` and
  // losing the thirteen checks that had already passed.
  let statusPresent = false;
  for (let i = 0; i < 60; i += 1) {
    if ((await statusTrigger.count()) > 0) { statusPresent = true; break; }
    await page.waitForTimeout(250);
  }

  // Recorded, not skipped: this block quietly did nothing on the first run.
  rec(statusPresent, 'the status filter is present',
    `not found after 15s — roster rows on screen: ${await page.locator('tbody tr').count()}`);

  // Guarded: a missing control is ONE failed check, not a dead script.
  if (statusPresent) {
    await statusTrigger.click();
    await page.waitForTimeout(1200);
    const options = (await page.locator('[role="option"]').allInnerTexts()).map((o) => o.trim());
    console.log(`   status options: ${JSON.stringify(options)}`);
    rec(options.some((o) => /^Active$/i.test(o)) && !options.includes('Manager'),
      'the status filter offers STATUSES rather than the role list',
      JSON.stringify(options));
    await page.keyboard.press('Escape');
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

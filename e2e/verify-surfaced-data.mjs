// Data the app collected or loaded and then kept to itself, plus a failure it
// reported as an empty result.
//
//  the FR `type` is required by the create form and was rendered nowhere
//  the FR detail dialog loaded its implementing tasks and never listed them
//  a FAILED leave-balance fetch said "No leave balance data available", the same
//    words as a genuinely empty allowance, with nothing to retry
//  /tasks?projectId=<id that does not exist> rendered a convincing empty board
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('surfaced');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// ---- an FR with a type, and a task implementing it --------------------------
console.log('===== the functional-requirement dialog');
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SF-R',
  title: 'Parent requirement', clientName: 'Surfaced Ltd', priority: 'HIGH', status: 'DRAFT',
});
const fr = await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'SF-FR', title: 'Requirement with a type', status: 'DRAFT',
  priority: 'HIGH', complexity: 'HIGH', type: 'NON_FUNCTIONAL',
});
rec(fr.s === 201, 'the functional requirement was created', `${fr.s} ${fr.t.slice(0, 200)}`);
rec(fr.j?.type === 'NON_FUNCTIONAL', 'and the API stored its type',
  JSON.stringify(fr.j?.type));

const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SF-T1',
  title: 'Implements the requirement', status: 'TODO', priority: 'HIGH',
  functionalRequirementId: fr.j?.id, assigneeIds: [mgrId],
});
rec(task.s === 201 && task.j?.functionalRequirementId === fr.j?.id,
  'and a task is linked to it', `${task.s} ${task.t.slice(0, 200)}`);

{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await page.goto(`${BASE}/functional-requirements?frId=${fr.j.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const body = await page.locator('body').innerText().catch(() => '');

  rec(/Requirement with a type/.test(body), 'the detail dialog opened',
    body.slice(0, 300).replace(/\n/g, ' | '));
  rec(/\bType\b/.test(body) && /non[ _]functional/i.test(body),
    'the type the create form demanded is shown back',
    body.slice(0, 700).replace(/\n/g, ' | '));
  rec(/Implementing Tasks/i.test(body),
    'the implementing tasks it already loaded are listed',
    body.slice(0, 700).replace(/\n/g, ' | '));
  rec(/SF-T1/.test(body) && /Implements the requirement/.test(body),
    'and the linked task is named',
    body.slice(0, 800).replace(/\n/g, ' | '));
  await ctx.close();
}

// ---- a projectId that names nothing -----------------------------------------
console.log('\n===== /tasks with a projectId that does not exist');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await page.goto(`${BASE}/tasks?projectId=definitely-not-a-project-9f2a`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(9000);
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(`   screen says: ${JSON.stringify(body.slice(-400).replace(/\n/g, ' | '))}`);
  rec(/not in this workspace|no longer exists/i.test(body),
    'the page says the link named a project it does not have',
    body.slice(0, 400).replace(/\n/g, ' | '));
  rec(!/\(0 total\)/.test(body) || /not in this workspace/i.test(body),
    'rather than presenting itself as a real project with no work in it',
    body.slice(0, 400).replace(/\n/g, ' | '));

  // A REAL projectId must still work, so the guard is a guard and not a wall.
  await page.goto(`${BASE}/tasks?projectId=${p.project}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const good = await page.locator('body').innerText().catch(() => '');
  rec(!/not in this workspace/i.test(good),
    'a real projectId is still accepted',
    good.slice(0, 300).replace(/\n/g, ' | '));
  rec(/SF-T1|Implements the requirement/.test(good),
    "and shows that project's tasks",
    good.slice(0, 400).replace(/\n/g, ' | '));
  await ctx.close();
}

// ---- a failed balance fetch is not an empty allowance -----------------------
console.log('\n===== the leave Balance tab when the request fails');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  // Break only the balance call, so the failure is the thing under test.
  await page.route('**/api/v1/leave_balances/**', (route) => route.abort('failed'));
  await visit(page, '/leave', 7000);

  const balanceTab = page.getByRole('tab', { name: /balance/i }).first();
  rec(await balanceTab.count() > 0, 'the Balance tab exists', String(await balanceTab.count()));
  if (await balanceTab.count()) {
    await balanceTab.click();
    await page.waitForTimeout(6000);
    const body = await page.locator('body').innerText().catch(() => '');
    console.log(`   screen says: ${JSON.stringify(body.slice(-320).replace(/\n/g, ' | '))}`);
    rec(!/No leave balance data available/i.test(body),
      'a failed fetch is not reported as "no leave balance data"',
      body.slice(0, 400).replace(/\n/g, ' | '));
    rec(/could not load|did not complete/i.test(body),
      'it says the request failed',
      body.slice(0, 400).replace(/\n/g, ' | '));
    const retry = page.getByRole('button', { name: /try again/i }).first();
    rec(await retry.count() > 0, 'and offers a retry', String(await retry.count()));

    // With the route restored, the retry must actually recover.
    await page.unroute('**/api/v1/leave_balances/**');
    if (await retry.count()) {
      await retry.click();
      await page.waitForTimeout(7000);
      const after = await page.locator('body').innerText().catch(() => '');
      rec(!/could not load/i.test(after),
        'and the retry recovers once the request can succeed',
        after.slice(0, 400).replace(/\n/g, ' | '));
    }
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

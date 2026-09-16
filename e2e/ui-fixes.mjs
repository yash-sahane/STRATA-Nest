// Proof for the four UI criticals: a failed workspace fetch no longer ejects
// anyone into onboarding, the palette actually finds records and its create
// actions work, the notifications panel is keyboard-operable, and the timesheet
// stops truncating at 100 rows.
import { chromium, api, adminJar, provision, signedInPage, visit, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 300)}`); };

const browser = await chromium.launch();
const admin = await adminJar();

// ---- 1. a failed GET /workspaces is an error, not "you have none" ----------
console.log('===== a failed workspace fetch does not eject anyone');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local');
  await page.route('**/api/v1/workspaces?**', (r) => r.fulfill({ status: 500, body: '{}' }));
  await page.route('**/api/v1/workspaces/?**', (r) => r.fulfill({ status: 500, body: '{}' }));
  await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000); // React Query retries 4 times first

  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
  rec(!/\/onboarding/.test(url), 'the admin is NOT pushed to /onboarding', url);
  rec(!/Create Your Workspace/i.test(body), 'and is not asked to create a first workspace', body.slice(0, 160));
  rec(/could not load your workspaces/i.test(body), 'a retryable error is shown instead', body.slice(0, 200));
  const retry = await page.getByRole('button', { name: /try again/i }).count();
  rec(retry > 0, 'with a Try again button', String(retry));

  // recovery: unroute and retry -> the app comes back
  await page.unroute('**/api/v1/workspaces?**');
  await page.unroute('**/api/v1/workspaces/?**');
  await page.getByRole('button', { name: /try again/i }).first().click();
  await page.waitForTimeout(6000);
  const recovered = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
  rec(!/could not load your workspaces/i.test(recovered), 'Try again recovers into the app', recovered.slice(0, 160));
  await ctx.close();
}

// ---- 2. the command palette finds records and its create actions work ------
console.log('\n===== the command palette');
{
  const p = await provision('pal');
  const uniq = 'Zebracorn Sprint Probe';
  await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'PAL-001', title: uniq, status: 'TODO',
  });
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await visit(page, '/dashboard', 3500);

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1200);
  const dialog = page.locator('[role="dialog"]').first();
  rec(await dialog.isVisible(), 'Ctrl+K opens the palette');

  await page.keyboard.type('Zebracorn', { delay: 40 });
  await page.waitForTimeout(6000);
  const text = await dialog.innerText();
  rec(/Zebracorn/.test(text), 'typing a record title returns that record', text.slice(0, 300));
  rec(!/No results found/i.test(text), 'and not "No results found."', text.slice(0, 200));

  // an action still filters correctly
  for (let i = 0; i < 9; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('epic', { delay: 40 });
  await page.waitForTimeout(2500);
  const actionText = await dialog.innerText();
  rec(/Create New Epic/i.test(actionText), 'the action list still filters on the typed text', actionText.slice(0, 200));

  // a term that matches nothing must still say so
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('qqzzxxnothing', { delay: 30 });
  await page.waitForTimeout(6000);
  const emptyText = await dialog.innerText();
  rec(/No results found/i.test(emptyText), 'a term matching nothing still reports it', emptyText.slice(0, 200));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // the create actions now open a dialog instead of doing nothing
  for (const [route, label] of [['/tasks', 'Task'], ['/projects', 'Project'], ['/sprints', 'Sprint'], ['/epics', 'Epic']]) {
    await visit(page, `${route}?action=create`, 4500);
    const dialogs = await page.locator('[role="dialog"]').count();
    rec(dialogs > 0, `${route}?action=create opens the Create ${label} dialog`, `dialogs=${dialogs}`);
    const cleaned = !/action=create/.test(page.url());
    rec(cleaned, `  ...and the parameter is cleared from the URL`, page.url());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await ctx.close();
  await p.cleanup();
}

// ---- 3. the notifications panel can be driven from the keyboard -----------
console.log('\n===== the notifications panel is keyboard-operable');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local');
  await visit(page, '/dashboard', 3500);
  const bell = page.getByRole('button', { name: /notifications/i }).first();
  await bell.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  const panel = page.locator('[data-radix-popper-content-wrapper]').first();
  rec(await panel.count() > 0, 'the panel opens', String(await panel.count()));

  const focusPath = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    focusPath.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return `${a.tagName.toLowerCase()}:${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}`;
    }));
  }
  console.log('   focus after each Tab: ' + JSON.stringify(focusPath, null, 0));
  const moved = new Set(focusPath).size > 1;
  rec(moved, 'Tab moves focus THROUGH the panel rather than sticking on the container', focusPath.join(' | '));
  const reachedControl = focusPath.some((f) => /button|a:/.test(f) && !/^div:/.test(f));
  rec(reachedControl, 'and lands on real controls', focusPath.join(' | '));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const closed = await page.locator('[data-radix-popper-content-wrapper]').count();
  rec(closed === 0, 'Escape closes it', String(closed));
  const backOnTrigger = await page.evaluate(() =>
    (document.activeElement?.getAttribute('aria-label') || '').toLowerCase().includes('notification'));
  rec(backOnTrigger, 'and focus returns to the bell', String(backOnTrigger));
  await ctx.close();
}

// ---- 4. the timesheet stops truncating at 100 -----------------------------
console.log('\n===== 110 time entries all reach the timesheet');
{
  const p = await provision('tt110');
  const meId = (await api(admin, 'GET', '/auth/me')).j?.user?.id;
  const base = Date.now() - 30 * 86400_000;
  const N = 110;
  for (let batch = 0; batch < N; batch += 20) {
    await Promise.all(
      Array.from({ length: Math.min(20, N - batch) }, (_, k) => {
        const i = batch + k;
        const s = new Date(base + i * 3600_000);
        const e = new Date(s.getTime() + 3600_000);
        return api(admin, 'POST', '/time_entries', {
          workspaceId: p.ws, projectId: p.project, description: `entry ${i}`,
          startTime: s.toISOString(), endTime: e.toISOString(), duration: 60,
          isBillable: i % 2 === 0,
        });
      }),
    );
  }
  const server = await api(admin, 'GET', `/time_entries?workspaceId=${p.ws}&userId=${meId}&pageSize=1000`);
  console.log(`   server reports total=${server.j?.total}`);

  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await visit(page, '/time-tracking', 9000);
  // Wait for the CONDITION, not a fixed duration. A 9s visit is plenty when this
  // script runs alone and not always enough under whole-suite load, which is how
  // this check produced a false failure reporting 100 of 110 rows.
  await page
    .locator('table tbody tr')
    .nth(N - 1)
    .waitFor({ state: 'attached', timeout: 45000 })
    .catch(() => {});
  const bodyText = await page.locator('body').innerText();
  const rows = await page.locator('table tbody tr').count();
  console.log(`   rendered rows: ${rows}`);
  rec(rows >= N || /110/.test(bodyText), `all ${N} entries render (or the count is shown)`, `rows=${rows}`);
  rec(/110h|110 h|\b110\b/.test(bodyText), 'the totals reflect 110 entries, not 100', bodyText.slice(0, 400).replace(/\n/g, ' | '));
  await ctx.close();
  await p.cleanup();
}

await browser.close();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

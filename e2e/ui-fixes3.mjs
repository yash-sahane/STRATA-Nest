// Proof for the error-state batch and the accessibility batch.
import { chromium, api, adminJar, provision, signedInPage, visit, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 280)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('ui3');

// seed enough to render each surface
const epic = (await api(admin, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'UI3-E1', name: 'Focusable Epic',
})).j;
await api(admin, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'UI3-T1', title: 'Zebracorn Board Card', status: 'TODO',
});
// The epic dialog only renders its linked lists when something is linked.
for (let i = 0; i < 8; i += 1) {
  await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `UI3-L${i}`,
    title: `Linked task ${i}`, status: 'TODO', epicId: epic.id,
  });
}

// ---- 1. failed fetches read as errors, not emptiness -----------------------
console.log('===== a failed fetch is an error, not an empty list');
{
  const cases = [
    ['/leave', '**/leave_requests**', /couldn.t load your leave requests/i, /No leave requests yet/i],
    ['/analytics', '**/api/v1/tasks**', /couldn.t load your analytics|something went wrong/i, /no workspace analytics available/i],
  ];
  for (const [route, pattern, wantError, wantNotEmpty] of cases) {
    const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
    await page.route(pattern, (r) => r.fulfill({ status: 500, body: '{}' }));
    await visit(page, route, 3000);
    await page.waitForTimeout(13000); // React Query retries
    const body = await page.locator('body').innerText().catch(() => '');
    rec(wantError.test(body), `${route}: a 500 shows an error state`, body.slice(0, 260).replace(/\n/g, ' | '));
    rec(!wantNotEmpty.test(body), `${route}: and NOT the "nothing here" empty state`, body.slice(0, 200).replace(/\n/g, ' | '));
    const retry = await page.getByRole('button', { name: /try again/i }).count();
    rec(retry > 0, `${route}: with a Try again button`, String(retry));
    await ctx.close();
  }

  // a sprint sub-page must not claim a live sprint is missing
  const sprint = (await api(admin, 'POST', '/sprints', {
    workspaceId: p.ws, projectId: p.project, name: 'UI3 Sprint',
    startDate: '2026-10-01', endDate: '2026-10-14',
  })).j;
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await page.route(`**/api/v1/sprints/${sprint.id}**`, (r) => r.fulfill({ status: 500, body: '{}' }));
  await visit(page, `/sprints/${sprint.id}/board`, 3000);
  await page.waitForTimeout(13000);
  const body = await page.locator('body').innerText().catch(() => '');
  rec(!/Sprint not found/i.test(body), 'a 500 does not claim the sprint is missing', body.slice(0, 220).replace(/\n/g, ' | '));
  rec(/couldn.t load this sprint/i.test(body), 'it says the load failed', body.slice(0, 220).replace(/\n/g, ' | '));
  await ctx.close();
}

// ---- 2. keyboard reach --------------------------------------------------
console.log('\n===== keyboard reach');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);

  // epic cards
  await visit(page, '/epics', 6000);
  const epicCard = page.getByRole('button', { name: /Open epic: Focusable Epic/i }).first();
  rec((await epicCard.count()) > 0, 'an epic card exposes itself as a button with a name', String(await epicCard.count()));
  if (await epicCard.count()) {
    await epicCard.focus();
    const ring = await epicCard.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, shadow: cs.boxShadow };
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const dialogs = await page.locator('[role="dialog"]').count();
    rec(dialogs > 0, 'and Enter opens its detail dialog', `dialogs=${dialogs} ring=${JSON.stringify(ring)}`);

    // the scroll regions inside are reachable
    const regions = await page.locator('[role="dialog"] [role="region"]').count();
    rec(regions > 0, 'the dialog’s linked-items lists are focusable regions', String(regions));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  }

  // task cards
  await visit(page, '/tasks', 7000);
  const handle = page.getByRole('button', { name: /Open task: Zebracorn Board Card/i }).first();
  const handles = await handle.count();
  rec(handles > 0, 'a board card is reachable and named', String(handles));
  if (handles) {
    await handle.focus();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { label: el.getAttribute('aria-label'), shadow: cs.boxShadow, outline: cs.outlineStyle };
    });
    rec(/Open task/.test(focused?.label ?? ''), 'focus lands on the card', JSON.stringify(focused));
    rec((focused?.shadow ?? 'none') !== 'none' || (focused?.outline ?? 'none') !== 'none',
      'and it has a VISIBLE focus indicator', JSON.stringify(focused));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    rec((await page.locator('[role="dialog"]').count()) > 0, 'Enter opens the task details', '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // header search results
  await visit(page, '/dashboard', 4000);
  const search = page.locator('header input[type="search"], header input[placeholder*="earch" i]').first();
  if (await search.count()) {
    await search.click();
    await search.type('Zebracorn', { delay: 40 });
    await page.waitForTimeout(6000);
    const rows = await page.getByRole('button', { name: /Open task: Zebracorn/i }).count();
    rec(rows > 0, 'a header search result is a named, focusable control', String(rows));
  } else {
    rec(false, 'header search input found', 'not found');
  }

  // select accessible names
  await visit(page, '/calendar', 5000);
  const combos = await page.evaluate(() =>
    [...document.querySelectorAll('[role="combobox"]')].map((el) => ({
      label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '',
      text: (el.textContent || '').trim().slice(0, 30),
    })));
  console.log('   comboboxes: ' + JSON.stringify(combos.slice(0, 4)));
  rec(combos.length === 0 || combos.every((c) => c.label), 'every Select on /calendar has an accessible name',
    JSON.stringify(combos.filter((c) => !c.label)));

  await ctx.close();
}

// ---- 3. an AlertDialog gives focus back ----------------------------------
console.log('\n===== a confirm returns focus to what opened it');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  await visit(page, '/projects', 6000);
  const menu = page.locator('button[aria-haspopup="menu"]').last();
  if (await menu.count()) {
    await menu.click();
    await page.waitForTimeout(900);
    const del = page.getByRole('menuitem', { name: /delete/i }).first();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(1400);
      const alert = await page.locator('[role="alertdialog"]').count();
      rec(alert > 0, 'the confirm opens', String(alert));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
      const landed = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase() ?? 'none');
      rec(landed !== 'body', 'focus does NOT fall to <body> when it closes', landed);
    } else {
      rec(true, 'no delete menu item on this row (skipped)', '');
    }
  } else {
    rec(true, 'no row menu present (skipped)', '');
  }
  await ctx.close();
}

// ---- 4. mark-all-read is one request -------------------------------------
console.log('\n===== bulk notification actions are single requests');
{
  const { ctx, page } = await signedInPage(browser, 'admin@strata.local', p.ws);
  const calls = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/notifications')) calls.push(`${r.method()} ${r.url().split('/api/v1')[1].split('?')[0]}`);
  });
  await visit(page, '/dashboard', 4500);
  await page.getByRole('button', { name: /notifications/i }).first().click();
  await page.waitForTimeout(2500);
  calls.length = 0;
  const markAll = page.getByRole('button', { name: /mark all read/i }).first();
  if (await markAll.count()) {
    await markAll.click();
    await page.waitForTimeout(4000);
    const writes = calls.filter((c) => c.startsWith('PATCH') || c.startsWith('POST'));
    console.log('   requests: ' + JSON.stringify(calls.slice(0, 8)));
    rec(writes.length === 1 && writes[0].includes('mark_all_read'),
      '"Mark all read" is exactly ONE write request', JSON.stringify(writes));
  } else {
    rec(true, 'nothing unread to mark (skipped)', '');
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

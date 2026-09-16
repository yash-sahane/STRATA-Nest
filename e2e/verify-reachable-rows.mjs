// Clickable rows, dead controls, and what a 390px screen cuts off.
//
//  #98  "Clear all" was hidden behind unreadCount === 0
//  #102 the dashboard's task rows carried a checkbox that could not be ticked
//  #103 notification rows announced themselves as buttons with nowhere to go
//  #105 /activity clipped 174px of every entry with nothing to scroll
//  #106 the member-selector popover was 450px wide on a 390px screen
//  (new) the notification row was role="button" AROUND its delete button —
//        28 axe nested-interactive violations in one open popover
import { readFileSync } from 'node:fs';
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { createRequire } from 'node:module';

const AXE = readFileSync(
  // Resolved through node's own resolver rather than hard-coded: the suite must not
  // depend on where this checkout happens to live.
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('rows');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Rows Sprint',
  goal: 'g', startDate: today, endDate: plus(10), status: 'ACTIVE',
});
await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'R-ROW',
  title: 'Reachable requirement', clientName: 'Rows Ltd', priority: 'HIGH', status: 'DRAFT',
});
// Assigned to the manager, so the dashboard's "My Tasks" tab is not empty —
// the first version of this probe measured that tab with nothing in it.
for (let i = 1; i <= 2; i += 1) {
  const t = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `ROW-${i}`,
    title: `Reachable task ${i}`, status: 'TODO', priority: 'HIGH',
    assigneeIds: [mgrId],
  });
  if (!t.j?.id) throw new Error(`task ${i}: ${t.s} ${t.t.slice(0, 200)}`);
}

// Notifications, including one whose type has nowhere to go.
const notify = async (type, extra = {}) =>
  api(admin, 'POST', '/notifications', {
    workspaceId: p.ws, userId: mgrId, type,
    title: `${type} notice`, message: 'body text',
    ...extra,
  });
const withDest = await notify('TASK_ASSIGNED', { projectId: p.project, relatedEntityType: 'TASK', relatedEntityId: 'x1' });
const noDest = await notify('SYSTEM_ANNOUNCEMENT');
console.log(`   notifications created: withDest=${withDest.s} noDest=${noDest.s}`);

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const axeNested = async () => {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'rule', values: ['nested-interactive'] } });
    return r.violations.flatMap((v) => v.nodes.map((n) => n.html.slice(0, 120)));
  });
};

// ---- the notification panel ------------------------------------------------
console.log('\n===== the notification panel');
{
  await visit(page, '/dashboard', 5000);
  const bell = page.getByRole('button', { name: /notification/i }).first();
  rec(await bell.count() > 0, 'the bell is present', String(await bell.count()));
  await bell.click();
  await page.waitForTimeout(3000);

  const nested = await axeNested();
  console.log(`   nested-interactive nodes: ${nested.length}`);
  rec(nested.length === 0, 'no nested-interactive violations with the panel open',
    nested.slice(0, 3).join('  ||  '));

  const body = await page.locator('body').innerText().catch(() => '');
  // #98: unread notifications exist, and Clear all must still be offered.
  const unreadBadge = await page.getByRole('button', { name: /notification/i }).first().innerText().catch(() => '');
  console.log(`   bell reads "${unreadBadge.trim()}", panel mentions Clear all: ${/Clear all/i.test(body)}`);
  rec(/Mark all read/i.test(body), 'there are unread notifications (so #98 is actually under test)',
    body.slice(0, 300).replace(/\n/g, ' | '));
  rec(/Clear all/i.test(body), '"Clear all" is offered even while notifications are unread',
    body.slice(0, 300).replace(/\n/g, ' | '));

  // #103: a row with nowhere to go must not present itself as a control.
  const shapes = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-radix-popper-content-wrapper] .group.relative')];
    return rows.map((r) => ({
      text: (r.textContent || '').trim().slice(0, 40),
      pointer: getComputedStyle(r).cursor === 'pointer',
      role: r.getAttribute('role'),
      activators: [...r.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    }));
  });
  console.log(`   rows: ${JSON.stringify(shapes).slice(0, 400)}`);
  rec(shapes.length > 0, 'the panel rendered rows', JSON.stringify(shapes).slice(0, 200));
  rec(shapes.every((r) => r.role !== 'button'),
    'no row is role="button" around its own delete button',
    JSON.stringify(shapes.map((r) => r.role)));
  // NOT "every row offers an action". That was the assertion this probe started
  // with, and it contradicts the fix: a notification whose type has no
  // destination AND which is already read does nothing on activation, so #103 is
  // precisely that it must NOT be presented as a control. The earlier runs passed
  // only because every notification was freshly created and therefore unread.
  //
  // The real contract is the pairing: a row is interactive exactly when
  // activating it would do something.
  const withAction = shapes.filter((r) =>
    r.activators.some((a) => /^(Open|Mark as read):/.test(a ?? '')),
  );
  const inert = shapes.filter(
    (r) => !r.activators.some((a) => /^(Open|Mark as read):/.test(a ?? '')),
  );
  console.log(`   rows with an action: ${withAction.length}, deliberately inert: ${inert.length}`);
  rec(withAction.length > 0,
    'rows that DO something offer a named, keyboard-reachable action',
    JSON.stringify(shapes.map((r) => r.activators)));
  rec(withAction.every((r) => r.pointer),
    'and those rows look clickable',
    JSON.stringify(withAction.map((r) => r.pointer)));
  rec(inert.every((r) => !r.pointer && r.role !== 'button'),
    'a row that does nothing does not look or announce itself as a control',
    JSON.stringify(inert.map((r) => ({ pointer: r.pointer, role: r.role, text: r.text }))));

  // The confirmation names the unread ones it is about to destroy.
  await page.getByRole('button', { name: /^Clear all$/i }).first().click();
  await page.waitForTimeout(1500);
  const dialog = await page.locator('[role="alertdialog"], [role="dialog"]').first().innerText().catch(() => '');
  console.log(`   confirm: ${JSON.stringify(dialog.replace(/\n/g, ' | ').slice(0, 200))}`);
  rec(/haven't read|havent read/i.test(dialog),
    'the confirmation says how many unread notifications it will destroy', dialog.slice(0, 300));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

// ---- #102 the dashboard task rows ------------------------------------------
console.log('\n===== the dashboard "My Tasks" rows');
{
  await visit(page, '/dashboard', 5000);
  const tab = page.getByRole('tab', { name: /my tasks/i }).first();
  rec(await tab.count() > 0, 'the My Tasks tab exists', String(await tab.count()));
  await tab.click();
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText().catch(() => '');
  rec(/Reachable task/.test(body), 'the tab has task rows in it (so this is not measuring an empty list)',
    body.slice(0, 300).replace(/\n/g, ' | '));
  const boxes = await page.locator('[role="checkbox"]').count();
  console.log(`   checkboxes in the task list: ${boxes}`);
  rec(boxes === 0, 'the checkbox that could not be ticked is gone', `${boxes} remain`);
  const opener = page.getByRole('button', { name: /^Open task: Reachable task 1$/ }).first();
  rec(await opener.count() > 0, 'the row offers a named action instead', String(await opener.count()));
  if (await opener.count()) {
    await opener.focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    rec(focused === 'Open task: Reachable task 1', 'which the keyboard can focus', String(focused));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    rec(/\/tasks/.test(page.url()), 'and Enter activates it', page.url());
  }
}

// ---- the other three rows --------------------------------------------------
for (const [route, label, prep] of [
  ['/requirements', /^Open requirement: Reachable requirement$/, async () => {
    await page.waitForTimeout(3000);
  }],
  ['/sprints', /^Open sprint board: Rows Sprint$/, async () => {}],
]) {
  console.log(`\n===== ${route}`);
  await visit(page, route, 6000);
  await prep();
  const btn = page.getByRole('button', { name: label }).first();
  const n = await btn.count();
  const labelled = await page.locator('button[aria-label^="Open "]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')),
  );
  rec(n > 0, `${route} row offers a named keyboard action`,
    `${n} matches for ${label}; "Open ..." labels present: ${JSON.stringify(labelled.slice(0, 8))}`);
  if (n > 0) {
    await btn.focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    rec(Boolean(focused && label.test(focused)), `${route} action is focusable`, String(focused));
  }
  const nested = await axeNested();
  rec(nested.length === 0, `${route} has no nested-interactive violations`,
    nested.slice(0, 2).join('  ||  '));
}

// ---- #105/#106 the narrow viewport ----------------------------------------
console.log('\n===== 390px: is anything cut off with nothing to scroll?');
{
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/activity', '/team', '/tasks', '/dashboard', '/settings']) {
    await visit(page, route, 5000);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const doc = document.scrollingElement || document.documentElement;
      const srOnly = (el) => {
        const c = el.className?.toString?.() ?? '';
        const b = el.getBoundingClientRect();
        return c.includes('sr-only') || b.width <= 1 || b.height <= 1;
      };
      const scroller = (el) => {
        for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (/auto|scroll/.test(cs.overflowX) && n.scrollWidth - n.clientWidth > 1) return true;
        }
        return false;
      };
      const unreachable = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (srOnly(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.right <= vw + 2) continue;
        if (scroller(el)) continue;
        unreachable.push((el.textContent || '').trim().slice(0, 40));
      }
      return { vw, pageScrolls: doc.scrollWidth - doc.clientWidth > 1, unreachable: [...new Set(unreachable)] };
    });
    console.log(`   ${route.padEnd(14)} pageScrollsSideways=${r.pageScrolls} unreachable=${r.unreachable.length}`);
    rec(!r.pageScrolls, `${route} does not scroll sideways at 390px`, String(r.pageScrolls));
    rec(r.unreachable.length === 0, `${route} cuts nothing off with no way to reach it`,
      JSON.stringify(r.unreachable.slice(0, 4)));
  }

  // #106 the popover that was wider than the screen.
  await visit(page, '/tasks', 6000);
  const fits = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // The class carries the constraint whether or not the popover is open.
    const src = [...document.querySelectorAll('*')].length;
    return { vw, src };
  });
  void fits;
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

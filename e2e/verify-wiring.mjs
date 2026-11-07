// What can be used looks usable, says why when it cannot, and works from any
// input; what was dead is gone.
//
//  - raw buttons show the pointer; toasts sit bottom right, off the header;
//  - badges do not change under the mouse; static cards do not lift;
//  - the phone menu lists only what the sidebar does; search opens on focus,
//    says it needs two letters, opens "+N more", names priorities;
//  - the command palette has a button, and its shortcut is this keyboard's;
//  - controls have names: settings switches, calendar days, the sort button;
//  - moving somebody's work asks first; a workspace with no projects says so;
//  - the server mints ids a create leaves out, and puts a new card at the end;
//  - no browser asks the server for the deadline scan.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, getJar, recorder, BASE } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t ?? JSON.stringify(r.j)).slice(0, 200)}`;
const flat = (text) => String(text).replace(/\s+/g, ' ');
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('wiring');
const code = 'WIRI';
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

// ---- the server mints what a create leaves out -------------------------------------------
console.log('===== ids are minted by the server');
{
  const epic = await api(mgr, 'POST', '/epics', { workspaceId: p.ws, projectId: p.project, name: 'Search', status: 'TODO' });
  rec(epic.s === 201 && /^[A-Z]+-EPIC-\d{2}$/.test(epic.j?.hierarchyId ?? ''), 'an epic created without an id gets the next one',
    `${brief(epic)} -> ${epic.j?.hierarchyId}`);
  const fr = await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws, projectId: p.project, title: 'Search box', epicId: epic.j?.id,
    status: 'DRAFT', complexity: 'LOW', type: 'FUNCTIONAL', priority: 'HIGH',
  });
  rec(fr.s === 201 && new RegExp(`-SEA-SEA-\\d{2}$`).test(fr.j?.hierarchyId ?? ''),
    'a requirement gets one from its epic and its own name', `${brief(fr)} -> ${fr.j?.hierarchyId}`);
  const first = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, title: 'Index the catalogue', functionalRequirementId: fr.j?.id,
    status: 'TODO', priority: 'MEDIUM', assigneeIds: [devId],
  });
  rec(first.s === 201 && String(first.j?.hierarchyId).startsWith(`${fr.j?.hierarchyId}-IND-`),
    'a task gets one under its requirement', `${brief(first)} -> ${first.j?.hierarchyId}`);
  const plain = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, title: 'Tidy the readme', status: 'TODO', priority: 'LOW',
  });
  rec(plain.s === 201 && /^[A-Z]+-T\d{2}$/.test(plain.j?.hierarchyId ?? ''), 'and one of the project\'s own without one',
    `${brief(plain)} -> ${plain.j?.hierarchyId}`);
  const sub = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, title: 'Write the intro', parentTaskId: plain.j?.id, status: 'TODO', priority: 'LOW',
  });
  rec(sub.s === 201 && sub.j?.hierarchyId === `${plain.j?.hierarchyId}.01`, 'a sub-task, its parent\'s and .01',
    `${brief(sub)} -> ${sub.j?.hierarchyId}`);
  rec((plain.j?.position ?? -1) > (first.j?.position ?? -1), 'and a new card goes to the end of the board',
    JSON.stringify({ first: first.j?.position, then: plain.j?.position }));
}

// ---- interaction, at desktop width ----------------------------------------------------------
console.log('===== what can be clicked looks it; nothing sits over the header');
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  const scans = [];
  page.on('request', (r) => { if (/deadline_scan/.test(r.url())) scans.push(r.url()); });
  await visit(page, '/dashboard', 6000);
  rec(scans.length === 0, 'no browser asks for the deadline scan — the server runs it hourly', scans.join(' | '));
  const lifted = await page.locator('main .hover-lift').count();
  rec(lifted === 0, 'the dashboard\'s static cards do not lift under the mouse', `lifting: ${lifted}`);

  // A raw <button>: the calendar's days.
  await visit(page, '/calendar', 6000);
  const day = page.getByRole('button', { name: new RegExp(`^${dayFrom(0).toLocaleDateString('en-US', { weekday: 'long' })}`) }).first();
  const cursor = await day.evaluate((el) => getComputedStyle(el).cursor).catch(() => null);
  rec(cursor === 'pointer', 'a calendar day — a raw button — shows the pointer', String(cursor));
  const dayName = await day.getAttribute('aria-label').catch(() => null);
  rec(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d+/.test(dayName ?? ''), 'and says which day it is, not "18"', String(dayName));

  // A badge does not change under the mouse.
  await visit(page, `/tasks?projectId=${p.project}&scope=all`, 6000);
  const badge = page.locator('main [class*="rounded-full"][class*="border"]').filter({ hasText: /\S/ }).first();
  const before = await badge.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  await badge.hover().catch(() => {});
  await page.waitForTimeout(300);
  const after = await badge.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  rec(before !== null && before === after, 'a badge keeps its colour under the mouse', `${before} -> ${after}`);
  const sortButton = await page.getByRole('button', { name: /^Sort: / }).count();
  rec(sortButton > 0, 'the sort button is named, icon-only or not', `named sort buttons: ${sortButton}`);
  await page.getByRole('button', { name: /^Sort: / }).first().click();
  const combine = await page.getByRole('menuitemcheckbox', { name: 'Add to the current sort' }).count();
  rec(combine === 1, 'and combining sorts is in the menu, not Shift+Click alone', `items: ${combine}`);
  await page.keyboard.press('Escape');

  // A toast, and where it lands. sonner renders its list only while a toast is
  // up, so raise a real one: signing in through the form says "Welcome back!".
  {
    const fresh = await browser.newContext();
    const login = await fresh.newPage();
    await login.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await login.fill('#email', 'role.manager@strata.local');
    await login.fill('#password', 'RolePass123!');
    await login.locator('button[type="submit"]').click();
    const toaster = login.locator('[data-sonner-toaster]').first();
    await toaster.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    const where = {
      x: await toaster.getAttribute('data-x-position', { timeout: 2000 }).catch(() => null),
      y: await toaster.getAttribute('data-y-position', { timeout: 2000 }).catch(() => null),
    };
    rec(where.x === 'right' && where.y === 'bottom', 'toasts sit bottom right, off the header\'s controls', JSON.stringify(where));
    await fresh.close();
  }

  // A form in the server's HTML can be used before the page is live. Submitted
  // then, the browser sent it itself: GET /login?email=…&password=… — the password
  // in the address bar, the history and the server's log.
  {
    const early = await browser.newContext();
    const login = await early.newPage();
    const addresses = [];
    const sent = [];
    // Scripts held back, as on a slow connection: the form is on screen well before it is live.
    await login.route(/\.js(\?|$)/, (r) => setTimeout(() => r.continue().catch(() => {}), 4000));
    login.on('request', (r) => {
      if (r.isNavigationRequest()) addresses.push(r.url());
      if (r.method() === 'POST' && /\/auth\/login\/?$/.test(new URL(r.url()).pathname)) sent.push(r.postDataJSON());
    });
    await login.goto(`${BASE}/login`, { waitUntil: 'commit' });
    await login.waitForSelector('#password', { state: 'attached' });
    await login.fill('#email', 'nobody@example.invalid');
    await login.fill('#password', 'not-a-real-password');
    const waits = await login.locator('button[type="submit"]').isDisabled();
    await login.locator('button[type="submit"]').click({ timeout: 20000 }).catch(() => {});
    await login.waitForTimeout(3000);
    rec(waits, 'until the page is live, Sign In cannot be pressed', `disabled: ${waits}`);
    rec(addresses.every((u) => !/password=/i.test(u)), 'and the password never lands in an address',
      addresses.map((u) => u.replace(/password=[^&]*/i, 'password=<hidden>')).join(' | '));
    rec(sent.length === 1 && sent[0]?.email === 'nobody@example.invalid', 'what was typed before it was live is what is sent',
      JSON.stringify(sent.map((body) => body?.email)));
    await early.close();
  }

  // Search.
  const search = page.getByPlaceholder('Search tasks, projects, requirements...');
  await search.click();
  await search.fill('I');
  await page.waitForTimeout(800);
  const oneLetter = flat(await page.locator('body').innerText());
  rec(/search starts at two characters/i.test(oneLetter) && !/No results found/.test(oneLetter),
    'one letter says search starts at two, not "No results found"');
  await search.fill('');
  // The command palette's button, and the key this keyboard has.
  const opener = page.getByRole('button', { name: 'Open the command palette' });
  const label = (await opener.innerText().catch(() => '')).trim();
  rec(/^Ctrl K$|^⌘ K$/.test(label), 'the search box opens the command palette, with this keyboard\'s shortcut', label);
  await opener.click().catch(() => {});
  const palette = await page.getByRole('dialog').count();
  rec(palette > 0, 'and opening it works', `dialogs: ${palette}`);
  await page.keyboard.press('Escape');

  // Settings switches have names.
  await visit(page, '/settings?tab=appearance', 6000);
  const compact = await page.getByRole('switch', { name: 'Compact mode' }).count();
  const animations = await page.getByRole('switch', { name: 'Show animations' }).count();
  rec(compact === 1 && animations === 1, 'the Display switches are named by their labels', JSON.stringify({ compact, animations }));
  rec(errors.length === 0, 'none of these pages threw', errors.join(' | '));
  await ctx.close();
}

// ---- the phone ----------------------------------------------------------------------------------
console.log('===== the phone menu lists what the sidebar does');
{
  const desk = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(desk.page, '/dashboard', 6000);
  // The sidebar's own links: its <nav> is the one with the groups in it.
  const sidebar = (await desk.page.locator('nav.flex-1 a').allInnerTexts().catch(() => []))
    .map((t) => t.trim()).filter(Boolean);
  await desk.ctx.close();
  const phone = await signedInPage(browser, 'role.software_developer@strata.local', p.ws, { viewport: { width: 390, height: 844 } });
  await visit(phone.page, '/dashboard', 6000);
  await phone.page.getByRole('button', { name: 'Open navigation' }).first().click().catch(() => {});
  await phone.page.waitForTimeout(600);
  const items = (await phone.page.getByRole('menuitem').allInnerTexts().catch(() => []))
    .map((t) => t.trim())
    .filter((t) => t && t !== 'Switch workspace');
  const extra = items.filter((item) => !sidebar.includes(item));
  rec(items.length > 0 && sidebar.length > 0 && extra.length === 0,
    'the phone menu lists the pages the sidebar does, and no others', JSON.stringify({ sidebar, items, extra }));
  const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  rec(wide <= 1, 'and the page does not scroll sideways at 390px', `overflow: ${wide}px`);
  await phone.ctx.close();
}

// ---- moving somebody's work asks first; an empty workspace says so -----------------------------------
console.log('===== actions that move other work ask; empty states say what to do');
{
  const sprint = await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws, projectId: p.project, name: 'Wiring Sprint', goal: '', startDate: local(dayFrom(1)), endDate: local(dayFrom(14)),
  });
  const fr = await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws, projectId: p.project, title: 'Filters', sprintId: sprint.j?.id,
    status: 'DRAFT', complexity: 'LOW', type: 'FUNCTIONAL', priority: 'LOW',
  });
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/sprints/${sprint.j?.id}/backlog`, 6000);
  await page.getByRole('button', { name: 'Remove from Sprint' }).first().click().catch(() => {});
  const asked = await page.getByRole('alertdialog').waitFor({ timeout: 5000 }).then(() => true, () => false);
  rec(asked, 'taking a requirement out of a sprint asks first — its tasks go with it');
  if (asked) await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click().catch(() => {});
  const still = (await api(mgr, 'GET', `/functional_requirements/${fr.j?.id}`)).j?.sprintId;
  rec(still === sprint.j?.id, 'and Cancel keeps it there', String(still));
  await ctx.close();

  // A workspace with no projects.
  const empty = await api(admin, 'POST', '/workspaces', { name: 'QA wiring empty', description: 'no projects' });
  const blank = await signedInPage(browser, 'admin@strata.local', empty.j?.id);
  await visit(blank.page, '/epics', 6000);
  const text = flat(await blank.page.locator('main').innerText().catch(() => ''));
  rec(/no projects yet/i.test(text), 'a page that works inside a project says when there are none', text.slice(0, 200));
  const create = await blank.page.getByRole('link', { name: 'Create a project' }).count();
  rec(create > 0, 'and offers to create one, to somebody who may', `links: ${create}`);
  await blank.ctx.close();
  await api(admin, 'DELETE', `/workspaces/${empty.j?.id}?cascade=true`);
}

await browser.close();
await p.cleanup();
summary();

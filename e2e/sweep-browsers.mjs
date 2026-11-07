// Cross-engine sweep: the routes the rest of the suite only ever opens in Chromium,
// opened in Firefox and in WebKit (the engine behind Safari). Reports what a user of
// those browsers would call a defect — runtime errors, 5xx, a page that scrolls
// sideways, a screen that never finishes loading or renders nothing — and drives the
// few interactions that lean hardest on engine behaviour: dialogs, popovers, the
// command palette, the date picker, the theme switch and the sign-in form.
//
//   node sweep-browsers.mjs                    # firefox + webkit
//   node sweep-browsers.mjs chromium webkit    # any of chromium, firefox, webkit
//   SHOTS_DIR=<dir> node sweep-browsers.mjs    # also keep one screenshot per screen
//
// The engines are not installed with the suite's chromium:
//   pnpm --filter @strata/e2e exec playwright install firefox webkit
//
// A sweep, not a check: it reports findings and is not in regression-suite.mjs,
// because the nightly job installs chromium only.
import { firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSprint, chromium, api, adminJar, provision, signedInPage, visit, BASE } from './kit.mjs';

const ENGINES = { chromium, firefox, webkit };
const wanted = process.argv.slice(2).filter((a) => ENGINES[a]);
const engines = wanted.length ? wanted : ['firefox', 'webkit'];
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const findings = [];
const note = (severity, where, title, measured = '') => {
  findings.push({ severity, where, title, measured });
  console.log(`  ${severity.toUpperCase().padEnd(8)} ${title}${measured ? `\n           ${measured}` : ''}`);
};

/** Layout and dead-state problems, measured in the page. */
const AUDIT = `(() => {
  const doc = document.documentElement;
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > doc.clientWidth + 4) {
      overflowing.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 30) });
      if (overflowing.length > 3) break;
    }
  }
  const body = document.body.innerText || '';
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowing,
    stillLoading: /Loading\\.\\.\\.|Loading…/.test(body) ? body.match(/Loading[^\\n]{0,30}/)?.[0] : null,
    hasHeading: !!document.querySelector('h1, h2, [role="heading"]'),
    textLength: body.replace(/\\s+/g, ' ').trim().length,
    bodyStart: body.replace(/\\s+/g, ' ').slice(0, 100),
  };
})()`;

// Expected noise, the same in every engine: the session probe answers 401 before
// sign-in, and React's development hint. WebKit and Firefox word resource failures
// differently from Chromium, hence the looser 401 match.
const benign = (text) => /401|Unauthorized|Download the React DevTools/i.test(text);

// ------------------------------------------------------------------- setup
const admin = await adminJar();
const p = await provision('browsers');
console.log(`workspace ${p.ws} / project ${p.project}\n`);

const epic = (await api(admin, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'BR-E1', name: 'Checkout Rework',
  description: 'Rebuild the checkout funnel', status: 'IN_PROGRESS', progress: 40,
  startDate: '2026-09-01', endDate: '2026-12-01',
})).j;
const cr = (await api(admin, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, title: 'Customers can pay by card',
  description: 'Card payments end to end', priority: 'HIGH', status: 'APPROVED',
})).j;
const fr = (await api(admin, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'BR-FR1', title: 'Card capture form',
  clientRequirementId: cr?.id, epicId: epic?.id, status: 'IMPLEMENTED', progress: 60, complexity: 'HIGH',
})).j;
const sprint = (await createSprint(admin, {
  workspaceId: p.ws, projectId: p.project, name: 'Sprint 14', goal: 'Ship card capture',
  startDate: '2026-09-07', endDate: '2026-09-21', status: 'ACTIVE',
})).j;
const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
for (let i = 0; i < 10; i += 1) {
  await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `BR-T${i}`,
    title: `Browser task ${i} — card capture work item`, description: 'Seeded for the browser sweep',
    status: STATUSES[i % STATUSES.length], priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4],
    epicId: epic?.id, sprintId: i % 2 ? sprint?.id : undefined,
    functionalRequirementId: i % 3 ? fr?.id : undefined,
  });
}

const PRIVATE_ROUTES = [
  '/dashboard', '/projects', `/projects/${p.project}`, `/projects/${p.project}/settings`,
  '/requirements', '/functional-requirements', '/epics', '/sprints',
  `/sprints/${sprint?.id}/board`, `/sprints/${sprint?.id}/backlog`, `/sprints/${sprint?.id}/analytics`,
  '/tasks', '/team', '/attendance', '/time-tracking', '/leave',
  '/calendar', '/activity', '/analytics', '/workspaces', '/settings', '/profile',
  '/onboarding', '/change-password',
];
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password?token=deadbeefdeadbeefdeadbeef'];
const PASSES = [
  { theme: 'light', name: 'desktop', width: 1440, height: 950 },
  { theme: 'light', name: 'phone', width: 390, height: 844 },
  { theme: 'dark', name: 'desktop', width: 1440, height: 950 },
];

const slug = (route) => route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'root';

async function checkRoute(engine, pass, page, route, tracked) {
  const where = `${engine} ${pass.theme}/${pass.name} ${route.replace(/[0-9A-Za-z]{20,}/g, ':id')}`;
  tracked.errors.length = 0; tracked.consoleErrors.length = 0; tracked.failedRequests.length = 0;
  console.log(`\n[${where}]`);
  try {
    await visit(page, route, 3000);
  } catch (e) {
    note('high', where, 'navigation threw', String(e).split('\n')[0].slice(0, 160));
    return;
  }
  if (tracked.errors.length) note('critical', where, 'uncaught page error', tracked.errors.slice(0, 2).join(' | '));
  const loud = tracked.consoleErrors.filter((c) => !benign(c));
  if (loud.length) note('high', where, 'console error', loud.slice(0, 2).join(' | '));
  const server = tracked.failedRequests.filter((f) => /HTTP 5\d\d/.test(f));
  if (server.length) note('critical', where, 'server error', server.slice(0, 2).join(' | '));
  const a = await page.evaluate(AUDIT).catch(() => null);
  if (!a) { note('medium', where, 'audit could not run'); return; }
  if (a.scrollWidth > a.clientWidth + 4) {
    note('high', where, 'page scrolls sideways', `scrollWidth ${a.scrollWidth} vs ${a.clientWidth}; ${JSON.stringify(a.overflowing.slice(0, 2))}`);
  }
  if (a.stillLoading) note('high', where, 'still loading after settle', `"${a.stillLoading}"`);
  if (!a.hasHeading || a.textLength < 40) note('high', where, 'screen rendered next to nothing', `${a.textLength} chars: ${a.bodyStart}`);
  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, `${engine}-${pass.theme}-${pass.name}-${slug(route)}.png`) }).catch(() => {});
  }
}

/** Interactions whose implementation differs most between engines. Desktop, light. */
async function interactions(engine, page) {
  const where = `${engine} interactions`;
  console.log(`\n[${where}]`);
  const dialogOpens = async (label, open) => {
    try {
      await open();
      await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 4000 });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 4000 });
      console.log(`  ok       ${label}`);
    } catch (e) {
      note('high', where, `${label} did not open and close`, String(e).split('\n')[0].slice(0, 160));
    }
  };

  await visit(page, '/tasks', 3000);
  await dialogOpens('the new-task dialog', async () => {
    await page.getByRole('button', { name: /new task|create task|add task/i }).first().click();
  });

  await visit(page, '/dashboard', 3000);
  await dialogOpens('the command palette (Ctrl+K)', async () => {
    await page.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
    await page.keyboard.press('Control+k');
  });

  try {
    await page.getByRole('button', { name: /notification/i }).first().click();
    await page.locator('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]').first()
      .waitFor({ state: 'visible', timeout: 4000 });
    await page.keyboard.press('Escape');
    console.log('  ok       the notifications panel');
  } catch (e) {
    note('high', where, 'the notifications panel did not open', String(e).split('\n')[0].slice(0, 160));
  }

  try {
    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.getByRole('button', { name: /theme|dark mode|light mode/i }).first().click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (before === after) note('medium', where, 'the theme switch changed nothing', `dark before ${before}, after ${after}`);
    else console.log('  ok       the theme switch');
    await page.getByRole('button', { name: /theme|dark mode|light mode/i }).first().click().catch(() => {});
  } catch (e) {
    note('medium', where, 'no theme switch found', String(e).split('\n')[0].slice(0, 160));
  }

  try {
    await visit(page, '/leave', 3000);
    await page.getByRole('button', { name: /request leave/i }).first().click();
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 4000 });
    const picker = dialog.locator('button[aria-haspopup="dialog"], button:has-text("Pick a date"), [data-date-picker] button').first();
    if (await picker.count()) {
      await picker.click();
      await page.locator('[role="grid"]').first().waitFor({ state: 'visible', timeout: 4000 });
      console.log('  ok       the leave form date picker');
      await page.keyboard.press('Escape');
    } else if (await dialog.locator('input[type="date"]').count()) {
      note('low', where, 'the leave form still uses the browser date input', 'no app date picker in the dialog');
    } else {
      note('medium', where, 'no date control found in the leave form');
    }
    await page.keyboard.press('Escape');
  } catch (e) {
    note('high', where, 'the leave form or its date picker failed', String(e).split('\n')[0].slice(0, 160));
  }
}

/** The sign-in form itself, typed into — once per engine, so the login quota holds. */
async function signInThroughTheForm(engine, browser) {
  const where = `${engine} sign-in form`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await visit(page, '/login', 1500);
    await page.getByLabel(/email/i).first().fill('role.member@strata.local');
    await page.getByLabel(/password/i).first().fill('RolePass123!');
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
    console.log(`\n[${where}]\n  ok       signed in and left /login for ${new URL(page.url()).pathname}`);
  } catch (e) {
    note('critical', where, 'signing in through the form failed', String(e).split('\n')[0].slice(0, 160));
  }
  await ctx.close();
}

// ------------------------------------------------------------------- sweep
for (const engine of engines) {
  let browser;
  try {
    browser = await ENGINES[engine].launch();
  } catch (e) {
    note('critical', engine, 'the engine would not launch (installed?)', String(e).split('\n')[0].slice(0, 200));
    continue;
  }
  console.log(`\n${'='.repeat(72)}\n${engine} ${browser.version()}`);

  for (const pass of PASSES) {
    const signed = await signedInPage(browser, 'admin@strata.local', p.ws, { viewport: { width: pass.width, height: pass.height } });
    await signed.page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, pass.theme);
    for (const route of PRIVATE_ROUTES) await checkRoute(engine, pass, signed.page, route, signed);
    if (pass.name === 'desktop' && pass.theme === 'light') await interactions(engine, signed.page);
    await signed.ctx.close();

    // Signed out: a context with no cookies, the same listeners.
    const ctx = await browser.newContext({ viewport: { width: pass.width, height: pass.height } });
    const page = await ctx.newPage();
    const tracked = { errors: [], consoleErrors: [], failedRequests: [] };
    page.on('pageerror', (e) => tracked.errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') tracked.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('response', (r) => { if (r.status() >= 500) tracked.failedRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, pass.theme);
    for (const route of PUBLIC_ROUTES) await checkRoute(engine, pass, page, route, tracked);
    await ctx.close();
  }
  await signInThroughTheForm(engine, browser);
  await browser.close();
}

await p.cleanup();

// ------------------------------------------------------------------ report
console.log(`\n${'#'.repeat(72)}`);
const by = {};
findings.forEach((f) => (by[f.severity] = (by[f.severity] || 0) + 1));
console.log(`BROWSER SWEEP (${engines.join(', ')}): ${findings.length} findings`);
console.log(JSON.stringify(by));
for (const sev of ['critical', 'high', 'medium', 'low']) {
  const rows = findings.filter((f) => f.severity === sev);
  if (!rows.length) continue;
  console.log(`\n--- ${sev.toUpperCase()} (${rows.length})`);
  rows.forEach((r) => console.log(`  ${r.where}\n    ${r.title}${r.measured ? `\n    ${r.measured}` : ''}`));
}
writeFileSync(new URL('./sweep-browsers-findings.json', import.meta.url), JSON.stringify(findings, null, 2));
console.log('\nwritten to sweep-browsers-findings.json');

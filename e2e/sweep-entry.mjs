// The pages a user sees FIRST, which no sweep has ever looked at.
//
// sweep-all.mjs walks 22 authenticated routes. Its ROUTES list does not contain the auth
// group at all -- /login, /forgot-password, /reset-password, /change-password -- nor
// /onboarding, which sits in the dashboard group but was left out of the list, nor the
// root redirect or the 404. So the first screen anyone meets has never been swept for
// contrast, runtime errors, naming or overflow.
//
// That matters more than it would have a day ago: until `lab()` became parseable, every
// Tailwind default-palette colour was skipped by `judge` and silently counted as a pass.
// /change-password in particular paints a password-strength bar out of the raw palette.
//
// Same checks as the route sweep: runtime and console errors, failed requests, contrast
// with the floor the text's own size earns, controls a screen reader cannot name, and
// anything overflowing the viewport. Both themes, desktop and phone.
import { readFileSync } from 'node:fs';
import { chromium, provision, addRole, signedInPage, visit, BASE } from './kit.mjs';
import { COLLECT_TEXT_NODES, judge } from './color-utils.mjs';
import { createRequire } from 'node:module';

const AXE = readFileSync(
  // Resolved through node's own resolver, not hard-coded to one checkout.
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const AXE_RULES = ['button-name', 'link-name', 'input-button-name', 'image-alt', 'label',
  'duplicate-id-active', 'aria-input-field-name', 'select-name'];

const findings = [];
const note = (severity, where, title, measured) => {
  findings.push({ severity, where, title, measured });
  console.log(`     ${severity.toUpperCase().padEnd(6)} ${title}\n            ${measured}`);
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 950 },
  { name: 'phone', width: 390, height: 844 },
];

// Signed OUT. These are the entry points proper.
const PUBLIC_ROUTES = [
  '/login',
  '/forgot-password',
  '/reset-password?token=deadbeefdeadbeefdeadbeef',
  '/',
  '/a-route-that-does-not-exist',
];

// Signed IN, but still never swept.
const PRIVATE_ROUTES = [
  '/onboarding',
  '/change-password',
];

const browser = await chromium.launch();
const p = await provision('entry');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

let totalMeasured = 0;
let totalUnmeasured = 0;

/** Everything measurable about the page as it currently stands. */
const audit = async (page, where) => {
  // ---- contrast ------------------------------------------------------------
  const nodes = await page.evaluate(COLLECT_TEXT_NODES).catch(() => []);
  const bad = [];
  let measured = 0;
  let unmeasured = 0;
  for (const n of nodes) {
    const v = judge(n);
    if (!v) continue;
    if (v.unmeasured) { unmeasured += 1; continue; }
    measured += 1;
    if (!v.passes) bad.push({ ...n, ...v, c: Number(v.ratio.toFixed(2)) });
  }
  totalMeasured += measured;
  totalUnmeasured += unmeasured;

  // ---- naming --------------------------------------------------------------
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async (rules) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'rule', values: rules } });
    return r.violations.map((v) => ({
      id: v.id, count: v.nodes.length,
      samples: v.nodes.slice(0, 2).map((x) => x.html.slice(0, 110)),
    }));
  }, AXE_RULES).catch(() => []);
  const axeTotal = violations.reduce((a, v) => a + v.count, 0);

  // ---- layout --------------------------------------------------------------
  const layout = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const overflowing = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > docWidth + 2) {
        overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
      }
    }
    return {
      scrollsSideways: document.documentElement.scrollWidth > docWidth + 2,
      docWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: overflowing.slice(0, 3),
      bodyStart: (document.body.innerText || '').trim().slice(0, 90).replace(/\n/g, ' | '),
    };
  });

  console.log(`     ${measured} node(s) measured, ${bad.length} under floor, ${unmeasured} unmeasured, axe ${axeTotal}${layout.scrollsSideways ? ', SCROLLS SIDEWAYS' : ''}`);

  const worst = bad.sort((x, y) => x.c - y.c).slice(0, 3);
  if (worst.length) {
    note('medium', where, `${bad.length} of ${measured} text node(s) under the contrast floor`,
      worst.map((w) => `${w.c}:1 (needs ${w.floor}) rgb(${w.fg}) on rgb(${w.bg}) "${w.text}" <${w.tag} class="${w.cls}">`).join(' | '));
  }
  if (unmeasured) {
    note('high', where, `${unmeasured} text node(s) could NOT be measured for contrast`,
      'a colour format parseColor does not read');
  }
  if (axeTotal) {
    note('high', where, `${axeTotal} unnamed or ambiguous control(s)`,
      violations.map((v) => `${v.id} x${v.count}: ${v.samples.join(' ')}`).join(' | '));
  }
  if (layout.scrollsSideways) {
    note('medium', where, 'the page scrolls sideways',
      `${layout.scrollWidth}px in a ${layout.docWidth}px viewport — ${layout.overflowing.join(' | ')}`);
  }
  if (!layout.bodyStart) {
    note('high', where, 'the page rendered no text at all', 'body.innerText is empty');
  }
  return layout;
};

// =========================================================== signed out
for (const theme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();

    const errors = [];
    const consoleErrors = [];
    const failed = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText ?? 'unknown';
      // Navigating away cancels in-flight chunks and fonts. That is this sweep moving on,
      // not the app failing, and reporting it buries the real failures.
      if (/ERR_ABORTED/.test(why)) return;
      failed.push(`${r.method()} ${r.url().slice(0, 90)} (${why})`);
    });

    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);

    for (const route of PUBLIC_ROUTES) {
      errors.length = 0; consoleErrors.length = 0; failed.length = 0;
      const where = `${theme}/${vp.name} ${route}`;
      console.log(`\n[${where}]  (signed out)`);
      await visit(page, route, 4500);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForTimeout(600);

      const layout = await audit(page, where);
      console.log(`     url=${page.url().replace(BASE, '')}  text="${layout.bodyStart.slice(0, 60)}"`);

      if (errors.length) note('high', where, `${errors.length} runtime error(s)`, errors.slice(0, 2).join(' | '));
      // A signed-out page must not be firing failed API calls at the user.
      const realFailures = failed.filter((f) => !/favicon|\.map\b/.test(f));
      if (realFailures.length) {
        note('medium', where, `${realFailures.length} failed request(s)`, realFailures.slice(0, 3).join(' | '));
      }
      if (consoleErrors.length) {
        note('low', where, `${consoleErrors.length} console error(s)`, consoleErrors.slice(0, 2).join(' | '));
      }
    }
    await ctx.close();
  }
}

// =========================================================== signed in
for (const theme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    const { ctx, page, errors, consoleErrors, failedRequests } = await signedInPage(
      browser, 'role.manager@strata.local', p.ws,
      { viewport: { width: vp.width, height: vp.height } },
    );
    await page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);

    for (const route of PRIVATE_ROUTES) {
      errors.length = 0; consoleErrors.length = 0; failedRequests.length = 0;
      const where = `${theme}/${vp.name} ${route}`;
      console.log(`\n[${where}]  (signed in)`);
      await visit(page, route, 5500);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForTimeout(600);

      const layout = await audit(page, where);
      console.log(`     url=${page.url().replace(BASE, '')}  text="${layout.bodyStart.slice(0, 60)}"`);

      if (errors.length) note('high', where, `${errors.length} runtime error(s)`, errors.slice(0, 2).join(' | '));
      const realFailures = (failedRequests ?? []).filter((f) => !/favicon|\.map\b/.test(String(f)));
      if (realFailures.length) {
        note('medium', where, `${realFailures.length} failed request(s)`, realFailures.slice(0, 3).join(' | '));
      }
      if (consoleErrors.length) {
        note('low', where, `${consoleErrors.length} console error(s)`, consoleErrors.slice(0, 2).join(' | '));
      }
    }
    await ctx.close();
  }
}

await browser.close();
await p.cleanup();

console.log(`\n${'#'.repeat(72)}`);
console.log(`ENTRY SWEEP: ${findings.length} finding(s) over ${PUBLIC_ROUTES.length} public + ${PRIVATE_ROUTES.length} private routes x 2 themes x 2 viewports`);
console.log(`  contrast: ${totalMeasured} node(s) measured, ${totalUnmeasured} unmeasured`);
const bySeverity = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
console.log(`  ${JSON.stringify(bySeverity)}`);
for (const f of findings) {
  console.log(`\n  ${f.severity.toUpperCase()} ${f.where}\n    ${f.title}\n    ${f.measured.slice(0, 400)}`);
}

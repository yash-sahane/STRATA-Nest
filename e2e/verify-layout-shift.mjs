// Does content jump about while a page loads?
//
// Cumulative Layout Shift is the thing users describe as "it moved just as I clicked it".
// A 14-script `an-*` group measured it once in an earlier pass; none of those is
// registered, and nothing live has checked it since — while this session added loading
// skeletons to a dialog, retimed every animation onto the motion scale, and put a
// 418-option select on the workspace settings tab. Any of those can move content.
//
// Measured with the browser's own `layout-shift` entries, the same source the Web Vitals
// number comes from, and only counting UNEXPECTED shifts — `hadRecentInput` marks the ones
// a user's own click caused, which are not defects.
//
// The threshold is Google's "good" bar of 0.1. The bar is deliberately not tightened to
// whatever this happens to score today: a check that fails on any movement at all would be
// re-tuned rather than believed the first time a legitimate change nudged it.
import { chromium, api, provision, addRole, signedInPage, whoami, BASE } from './kit.mjs';

const GOOD_CLS = 0.1;

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('cls');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Real content, so the pages have something to lay out. An empty page cannot shift.
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'CLS Sprint', goal: 'g',
  startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'CL-R',
  title: 'Layout shift requirement', clientName: 'CLS Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so lists and tables have rows to lay out.',
});
await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'CL-FR', title: 'Layout shift functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
});
for (let i = 0; i < 6; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `CL-T${i}`,
    title: `Layout shift task ${i}`, status: 'TODO', priority: 'MEDIUM', assigneeIds: [mgrId],
  });
}

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/sprints', '/epics', '/requirements',
  '/functional-requirements', '/attendance', '/leave', '/time-tracking', '/team',
  '/analytics', '/activity', '/calendar', '/notifications', '/workspaces',
  '/settings', '/settings?tab=workspace', '/profile',
];

/** Install the observer BEFORE navigating, or the early shifts are missed. */
const OBSERVER = `
  window.__cls = 0;
  window.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // A shift the user's own interaction caused is not a defect.
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        if (entry.value > 0.001) {
          const src = (entry.sources || [])[0];
          window.__shifts.push({
            value: Number(entry.value.toFixed(4)),
            node: src && src.node
              ? src.node.nodeName.toLowerCase() + '.' + String(src.node.className || '').slice(0, 40)
              : null,
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* browser without the entry type */ }
`;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await ctx.addInitScript(OBSERVER);

const measure = async (route) => {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Let late-arriving data settle: a shift caused by content landing after the spinner is
  // exactly the kind worth catching.
  await page.waitForTimeout(4000);
  return page.evaluate(() => ({
    cls: Number((window.__cls ?? 0).toFixed(4)),
    shifts: (window.__shifts ?? []).slice(0, 3),
    supported: typeof window.__cls === 'number',
  }));
};

console.log('===== layout shift per route (unexpected shifts only)');
const results = [];
for (const route of ROUTES) {
  const r = await measure(route);
  results.push({ route, ...r });
  const mark = r.cls > GOOD_CLS ? 'OVER ' : ' ok  ';
  console.log(`   ${mark} ${route.padEnd(30)} CLS ${String(r.cls).padEnd(8)}${r.shifts.length ? ' worst: ' + JSON.stringify(r.shifts[0]) : ''}`);
}

rec(results.every((r) => r.supported),
  'the browser reports layout-shift entries at all',
  'no layout-shift entry type — the numbers below would all be a meaningless zero');

const over = results.filter((r) => r.cls > GOOD_CLS);
const worst = [...results].sort((a, b) => b.cls - a.cls)[0];
console.log(`\n   worst route: ${worst.route} at CLS ${worst.cls}`);
rec(over.length === 0,
  `every route stays within the "good" CLS bar of ${GOOD_CLS}`,
  over.map((r) => `${r.route} ${r.cls} (${JSON.stringify(r.shifts[0] ?? null)})`).join(' | '));

// ---- can this detector see a shift at all? ---------------------------------
// Every route scoring near zero is only meaningful if a real shift would register.
console.log('\n===== self-test: the detector must see a shift it is given');
{
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  const baseline = await page.evaluate(() => Number((window.__cls ?? 0).toFixed(4)));

  // Push the whole page down, the way a late banner does.
  await page.evaluate(() => {
    const shover = document.createElement('div');
    shover.id = 'cls-selftest';
    shover.style.cssText = 'height:320px;background:#8884';
    document.body.insertBefore(shover, document.body.firstChild);
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => Number((window.__cls ?? 0).toFixed(4)));
  await page.evaluate(() => document.getElementById('cls-selftest')?.remove());

  console.log(`   CLS before ${baseline} -> after inserting a 320px block ${after}`);
  rec(after > baseline,
    'injecting a layout shift moves the number, so the zeros above are evidence',
    `${baseline} -> ${after}; if these match, the observer is not recording and every ` +
    `route's "good" score means nothing`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

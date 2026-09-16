// The rest of WCAG A/AA — everything the naming checks never looked at.
//
// verify-a11y-names.mjs runs eight rules, all about whether a control has a name. That
// leaves most of the standard unexamined: heading order, landmarks, list structure, ARIA
// validity, table headers, focusable content hidden from the accessibility tree, a
// scrollable region no keyboard can reach, a viewport that forbids zoom.
//
// This runs the full wcag2a / wcag2aa / wcag21a / wcag21aa tag set instead of a
// hand-picked list, so the coverage is defined by the standard rather than by what
// happened to occur to me.
//
// `color-contrast` is the one deliberate exclusion. It is measured elsewhere, more
// carefully: axe reads backgroundColor and gives up on a gradient, which is exactly the
// blind spot that hid the entire signed-out experience until the sweeps learned to read a
// gradient's colour stops.
import { readFileSync } from 'node:fs';
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { createRequire } from 'node:module';

const AXE = readFileSync(
  // Resolved through node's own resolver rather than hard-coded: the suite must not
  // depend on where this checkout happens to live.
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 500)}`); };

const browser = await chromium.launch();
const p = await provision('a11ystruct');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Enough content that lists, tables and cards actually render rows.
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Structure Sprint', goal: 'g',
  startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'ST-R',
  title: 'Structure requirement', clientName: 'Structure Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so tables and lists have rows.',
});
await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'ST-FR', title: 'Structure functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
});
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'ST-E', name: 'Structure epic', status: 'TODO',
});
await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'ST-T',
  title: 'Structure task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
});

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/sprints', '/epics', '/requirements',
  '/functional-requirements', '/attendance', '/leave', '/time-tracking', '/team',
  '/analytics', '/activity', '/calendar', '/notifications', '/workspaces',
  '/settings', '/profile',
];

const scan = async (label) => {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      // Measured elsewhere, and more carefully: axe reads backgroundColor and gives up on
      // a gradient, which is the blind spot that hid every signed-out page.
      rules: { 'color-contrast': { enabled: false } },
    });
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        help: v.help,
        samples: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 110)),
      })),
      passes: r.passes.length,
    };
  });
  const total = result.violations.reduce((a, v) => a + v.count, 0);
  console.log(`   ${label.padEnd(28)} ${total === 0 ? 'clean' : `${total} node(s)`}  (${result.passes} rules passed)`);
  for (const v of result.violations) {
    console.log(`      ${String(v.impact).padEnd(8)} ${v.id} x${v.count} — ${v.help}`);
    for (const sample of v.samples) console.log(`         ${sample}`);
  }
  return { label, total, violations: result.violations };
};

const results = [];
for (const route of ROUTES) {
  await visit(page, route, 5500);
  results.push(await scan(route));
}

// ---- aggregate by RULE, which is how a fix gets scoped -----------------------
const byRule = new Map();
for (const r of results) {
  for (const v of r.violations) {
    const entry = byRule.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, nodes: 0, routes: [] };
    entry.nodes += v.count;
    entry.routes.push(r.label);
    byRule.set(v.id, entry);
  }
}

console.log(`\n===== ${byRule.size} distinct rule(s) violated across ${ROUTES.length} routes`);
for (const e of [...byRule.values()].sort((a, b) => b.nodes - a.nodes)) {
  console.log(`   ${String(e.impact).padEnd(8)} ${e.id.padEnd(28)} ${String(e.nodes).padStart(4)} node(s) on ${e.routes.length} route(s)`);
  console.log(`            ${e.help}`);
  console.log(`            ${e.routes.slice(0, 6).join(', ')}${e.routes.length > 6 ? ' …' : ''}`);
}

// ---- can this scan report a violation at all? -------------------------------
// 18 clean routes is only meaningful if the scan would have spoken up. Two deliberate
// faults are injected and both must come back, or the result above is not evidence.
console.log('\n===== self-test: the scan must catch a violation it is given');
{
  await visit(page, '/dashboard', 5000);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'axe-selftest';
    // image-alt (critical, wcag2a): an image with no alt text.
    const img = document.createElement('img');
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.width = 40;
    img.height = 40;
    host.appendChild(img);
    // aria-valid-attr-value (serious, wcag2a): aria-checked only takes true/false/mixed.
    const box = document.createElement('div');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'yes');
    box.setAttribute('tabindex', '0');
    box.textContent = 'Self test';
    host.appendChild(box);
    document.body.appendChild(host);
  });

  const broken = await scan('dashboard + injected faults');
  const ids = new Set(broken.violations.map((v) => v.id));
  rec(ids.has('image-alt'),
    'the scan reports an image with no alt text when one is present',
    `rules reported: ${[...ids].join(', ') || '(none)'}`);
  rec(ids.has('aria-valid-attr-value'),
    'and reports an invalid ARIA attribute value',
    `rules reported: ${[...ids].join(', ') || '(none)'}`);

  await page.evaluate(() => document.getElementById('axe-selftest')?.remove());
}

// Serious impacts are asserted; the rest are reported so the decision is informed rather
// than implicit.
const serious = [...byRule.values()].filter((e) => e.impact === 'critical' || e.impact === 'serious');
rec(serious.length === 0,
  'no critical or serious WCAG A/AA violation on any route',
  serious.map((e) => `${e.id} (${e.nodes} nodes, ${e.routes.length} routes)`).join(' | '));

const lesser = [...byRule.values()].filter((e) => e.impact !== 'critical' && e.impact !== 'serious');
console.log(`\n   moderate/minor rules reported, not asserted: ${lesser.length}`);
for (const e of lesser) console.log(`      ${e.id} — ${e.nodes} node(s)`);

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

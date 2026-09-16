// Every route, as every role. The paths a manager never walks.
//
// Every sweep so far ran as an admin or a MANAGER — the role with ALL permissions, which
// means it never renders a single permission-gated branch. A MEMBER is READ_ONLY, and
// DELIVERY roles sit in between, so between them they exercise a large amount of UI that
// has not been looked at: hidden actions, empty lists, "you cannot do that" states, and
// fields the API withholds.
//
// It also matters that these roles were last swept BEFORE the colour parser could read
// `lab()`. Whatever contrast was reported for them was measured on a fraction of the text
// and silently skipped the rest.
//
// Beyond the usual checks, this looks for the failure that is specific to a gated UI: a
// value the API withheld leaking into the page as `undefined`, `NaN`, `null` or
// `[object Object]`. That is what a missing permission-gated field looks like when nobody
// guarded the render, and a manager session can never produce it.
import { readFileSync } from 'node:fs';
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
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
  console.log(`      ${severity.toUpperCase().padEnd(6)} ${title}\n             ${measured}`);
};

const ROLES = [
  ['ASSISTANT_MANAGER', 'role.assistant_manager@strata.local'],
  ['SOFTWARE_DEVELOPER', 'role.software_developer@strata.local'],
  ['TESTER', 'role.tester@strata.local'],
  ['DEVELOPER_INTERN', 'role.developer_intern@strata.local'],
  ['CONTENT_ENGINEER', 'role.content_engineer@strata.local'],
  ['MEMBER', 'role.member@strata.local'],
];

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/sprints', '/epics', '/requirements',
  '/functional-requirements', '/attendance', '/leave', '/time-tracking', '/team',
  '/analytics', '/activity', '/calendar', '/notifications', '/workspaces',
  '/settings', '/profile',
];

// Values that should never reach the page. Word-bounded so "Undefined Behaviour" in a
// requirement title cannot trip it, and so "null" inside a longer word is ignored.
const LEAKS = [
  /\bundefined\b/i,
  /\bNaN\b/,
  /\[object Object\]/,
  /\bnull\b/i,
];

const browser = await chromium.launch();
const p = await provision('roles');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Content, created by the manager, so every other role has something to look at and to be
// refused by.
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Roles Sprint', goal: 'g',
  startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'RL-R',
  title: 'Roles requirement', clientName: 'Roles Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so every role has content to render.',
});
await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'RL-FR', title: 'Roles functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
});
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'RL-E', name: 'Roles epic', status: 'TODO',
});
await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'RL-T',
  title: 'Roles task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
});

let totalMeasured = 0;
let totalUnmeasured = 0;
const perRole = [];

for (const [role, email] of ROLES) {
  console.log(`\n${'#'.repeat(72)}\n# ${role}\n${'#'.repeat(72)}`);
  await addRole(p.ws, role, email);

  // Light theme: today's contrast failures were all in light, and a role sweep in the
  // theme where nothing has ever failed would be the weaker half of the pair.
  const { ctx, page, errors, consoleErrors, failedRequests } = await signedInPage(
    browser, email, p.ws, { viewport: { width: 1440, height: 950 } },
  );
  await page.evaluate(() => { try { localStorage.setItem('theme', 'light'); } catch {} });

  let roleMeasured = 0;
  let roleFindings = 0;

  for (const route of ROUTES) {
    errors.length = 0; consoleErrors.length = 0; failedRequests.length = 0;
    const where = `${role} ${route}`;
    await visit(page, route, 5000);
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(500);

    const before = findings.length;

    // ---- contrast --------------------------------------------------------
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
    totalMeasured += measured; roleMeasured += measured; totalUnmeasured += unmeasured;

    // ---- naming ----------------------------------------------------------
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async (rules) => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: 'rule', values: rules } });
      return r.violations.map((v) => ({ id: v.id, count: v.nodes.length, sample: v.nodes[0]?.html.slice(0, 100) }));
    }, AXE_RULES).catch(() => []);
    const axeTotal = violations.reduce((a, v) => a + v.count, 0);

    // ---- leaked placeholder values and empty screens ---------------------
    const page_ = await page.evaluate(() => ({
      text: (document.body.innerText || '').trim(),
      main: (document.querySelector('main')?.innerText || '').trim(),
    }));
    const leaked = LEAKS
      .map((re) => (page_.main.match(re) || [])[0])
      .filter(Boolean);

    console.log(`   ${route.padEnd(28)} ${measured} node(s), ${bad.length} under floor, axe ${axeTotal}, text ${page_.main.length}`);

    if (bad.length) {
      const worst = bad.sort((x, y) => x.c - y.c).slice(0, 2);
      note('medium', where, `${bad.length} of ${measured} text node(s) under the contrast floor`,
        worst.map((w) => `${w.c}:1 (needs ${w.floor}) rgb(${w.fg}) on rgb(${w.bg}) "${w.text}"`).join(' | '));
    }
    if (unmeasured) {
      note('high', where, `${unmeasured} text node(s) could not be measured`, 'unreadable colour format');
    }
    if (axeTotal) {
      note('high', where, `${axeTotal} unnamed control(s)`,
        violations.map((v) => `${v.id} x${v.count}: ${v.sample}`).join(' | '));
    }
    if (leaked.length) {
      // Show where it sits, since "null" can legitimately appear in prose.
      const context = LEAKS.map((re) => {
        const m = page_.main.match(re);
        if (!m) return null;
        const i = page_.main.indexOf(m[0]);
        return page_.main.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, ' | ');
      }).filter(Boolean);
      note('high', where, `a placeholder value reached the page: ${leaked.join(', ')}`, context.join('   ///   '));
    }
    if (page_.main.length < 15) {
      note('high', where, 'the main region rendered almost no text',
        `${page_.main.length} chars — a gated route should explain itself, not go blank`);
    }
    if (errors.length) {
      note('high', where, `${errors.length} runtime error(s)`, errors.slice(0, 2).join(' | '));
    }
    const realFailures = (failedRequests ?? []).filter((f) => !/favicon|\.map\b/.test(String(f)));
    if (realFailures.length) {
      note('medium', where, `${realFailures.length} failed request(s)`, realFailures.slice(0, 3).join(' | '));
    }
    const serverErrors = consoleErrors.filter((c) => /50\d|500 \(/.test(String(c)));
    if (serverErrors.length) {
      note('high', where, `${serverErrors.length} server error(s) in console`, serverErrors.slice(0, 2).join(' | '));
    }

    roleFindings += findings.length - before;
  }

  perRole.push({ role, measured: roleMeasured, findings: roleFindings });
  await ctx.close();
}

console.log(`\n${'#'.repeat(72)}`);
console.log(`ROLE SWEEP: ${findings.length} finding(s) over ${ROLES.length} roles x ${ROUTES.length} routes`);
console.log(`  contrast: ${totalMeasured} node(s) measured, ${totalUnmeasured} unmeasured`);
console.log('\n  per role:');
for (const r of perRole) {
  console.log(`    ${r.role.padEnd(20)} ${String(r.measured).padStart(5)} node(s) measured, ${r.findings} finding(s)`);
}
const bySeverity = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
console.log(`\n  ${JSON.stringify(bySeverity)}`);
for (const f of findings) {
  console.log(`\n  ${f.severity.toUpperCase()} ${f.where}\n    ${f.title}\n    ${String(f.measured).slice(0, 320)}`);
}

await browser.close();
await p.cleanup();

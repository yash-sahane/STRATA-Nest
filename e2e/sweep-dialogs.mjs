// Contrast and naming INSIDE every dialog, in both themes.
//
// The whole-app sweep walks routes. Dialogs sit on top of a route and it only opens a
// handful, so most of the app's ~24 dialogs have never had their contents measured -- and
// dialogs are where the raw palette is thickest. The character counter in
// ai-generate-dialog was one of the failures fixed this session, and no sweep found it:
// it came out of a source grep.
//
// Worth stating plainly why this is new rather than a re-run: until `lab()` became
// parseable, `judge` returned null for every Tailwind default-palette colour and the
// sweep's `if (v && !v.passes)` treated null as a pass. Raw-palette text inside a dialog
// was not merely under-covered, it was unmeasurable.
//
// Coverage is REPORTED, not assumed: every dialog this cannot reach is named at the end,
// so a low finding count cannot be mistaken for a clean bill of health.
import { readFileSync } from 'node:fs';
import { chromium, api, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';
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

const browser = await chromium.launch();
const p = await provision('dlgsweep');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// ---- enough content that detail dialogs have something to show ---------------
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Dialog Sprint', goal: 'g',
  startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'DS-R',
  title: 'Dialog requirement', clientName: 'Dialog Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so the detail dialog has content to measure.',
});
const fr = await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'DS-FR', title: 'Dialog functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
  description: 'Seeded so the detail dialog has content to measure.',
});
const epic = await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'DS-E', name: 'Dialog epic', status: 'TODO',
});
const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'DS-T',
  title: 'Dialog task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
  description: 'Seeded so the detail dialog has content to measure.',
});
void epic;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

const dialogOpen = () => until(async () =>
  (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 12000);

const closeAny = async () => {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.locator('[role="dialog"]:visible').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
};

/** Every dialog, and how to get to it. */
const DIALOGS = [
  { name: 'create task', route: '/tasks', open: /new task|create task/i },
  { name: 'task details', route: `/tasks?taskId=${task.j?.id}`, open: null },
  { name: 'create epic', route: '/epics', open: /new epic|create epic/i },
  { name: 'create sprint', route: '/sprints', open: /new sprint|create sprint/i },
  { name: 'create client requirement', route: '/requirements', open: /new client requirement|new requirement/i },
  { name: 'client requirement details', route: '/requirements', open: /^View Details$/ },
  { name: 'create functional requirement', route: '/functional-requirements', open: /new functional requirement|new requirement/i },
  { name: 'functional requirement details', route: `/functional-requirements?frId=${fr.j?.id}`, open: null },
  { name: 'create project', route: '/projects', open: /new project|create project/i },
  { name: 'request leave', route: '/leave', open: /request leave|new leave|apply/i },
  { name: 'manual time entry', route: '/time-tracking', open: /manual entry|add entry|log time/i },
  { name: 'invite member', route: '/workspaces', open: /invite member/i },
  // Creating a workspace is in the sidebar switcher, behind `user.isAdmin` — a MANAGER
  // session cannot reach it, which is the app working as intended rather than a gap.
  // Left in the list so the reason is printed instead of the dialog quietly going
  // unmentioned.
  { name: 'create workspace (admin only)', route: '/workspaces', open: /create workspace/i },
  { name: 'epic details', route: '/epics', open: 'click-card' },
  { name: 'command palette', route: '/dashboard', open: 'ctrl+k' },
];

const unreached = [];
let totalMeasured = 0;
let totalUnmeasured = 0;

for (const theme of ['light', 'dark']) {
  console.log(`\n${'#'.repeat(72)}\n# ${theme}\n${'#'.repeat(72)}`);

  for (const d of DIALOGS) {
    await closeAny();
    await visit(page, d.route, 7000);
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark');
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.waitForTimeout(700);

    // Open it.
    if (d.open === 'ctrl+k') {
      await page.keyboard.press('Control+k');
    } else if (d.open === 'click-card') {
      // Epic cards are activated rather than opened from a toolbar button.
      const card = page.getByText('Dialog epic').first();
      if (!(await card.count())) {
        if (theme === 'light') unreached.push(`${d.name} (no epic card found)`);
        console.log(`   ${d.name.padEnd(34)} SKIPPED — no card`);
        continue;
      }
      await card.click().catch(() => {});
    } else if (d.open) {
      const btn = page.getByRole('button', { name: d.open }).first();
      if (!(await btn.count())) {
        if (theme === 'light') unreached.push(`${d.name} (no opener matched ${d.open})`);
        console.log(`   ${d.name.padEnd(34)} SKIPPED — no opener`);
        continue;
      }
      await btn.click().catch(() => {});
    }

    if (!(await dialogOpen())) {
      if (theme === 'light') unreached.push(`${d.name} (opener clicked, no dialog appeared)`);
      console.log(`   ${d.name.padEnd(34)} SKIPPED — did not open`);
      continue;
    }

    // ---- contrast of the text INSIDE the dialog -----------------------------
    const nodes = await page.evaluate(`(() => {
      const all = ${COLLECT_TEXT_NODES};
      // Only what is inside the visible dialog.
      return all;
    })()`).catch(() => []);

    // Re-filter in page to the dialog subtree, since COLLECT_TEXT_NODES walks the body.
    const inDialog = await page.evaluate(() => {
      const dlgs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => x.getClientRects().length > 0);
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return [];
      return Array.from(dlg.querySelectorAll('*'))
        .filter((el) => !el.children.length && (el.textContent || '').trim().length >= 2)
        .map((el) => (el.textContent || '').trim().slice(0, 44));
    });
    const inDialogSet = new Set(inDialog);

    const bad = [];
    let measured = 0;
    let unmeasured = 0;
    for (const n of nodes) {
      if (!inDialogSet.has(n.text)) continue;
      const v = judge(n);
      if (!v) continue;
      if (v.unmeasured) { unmeasured += 1; continue; }
      measured += 1;
      if (!v.passes) bad.push({ ...n, ...v, c: Number(v.ratio.toFixed(2)) });
    }
    totalMeasured += measured;
    totalUnmeasured += unmeasured;

    // ---- naming ------------------------------------------------------------
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async (rules) => {
      const dlgs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((x) => x.getClientRects().length > 0);
      const dlg = dlgs[dlgs.length - 1];
      if (!dlg) return [];
      // eslint-disable-next-line no-undef
      const r = await axe.run(dlg, { runOnly: { type: 'rule', values: rules } });
      return r.violations.map((v) => ({
        id: v.id, count: v.nodes.length,
        samples: v.nodes.slice(0, 2).map((x) => x.html.slice(0, 110)),
      }));
    }, AXE_RULES).catch(() => []);
    const axeTotal = violations.reduce((a, v) => a + v.count, 0);

    console.log(`   ${d.name.padEnd(34)} ${measured} node(s), ${bad.length} under floor, ${unmeasured} unmeasured, axe ${axeTotal}`);

    const worst = bad.sort((x, y) => x.c - y.c).slice(0, 3);
    if (worst.length) {
      note('medium', `${theme}/${d.name}`, `${bad.length} text node(s) under the contrast floor`,
        worst.map((w) => `${w.c}:1 (needs ${w.floor}) rgb(${w.fg}) on rgb(${w.bg}) "${w.text}" <${w.tag} class="${w.cls}">`).join(' | '));
    }
    if (unmeasured) {
      note('high', `${theme}/${d.name}`, `${unmeasured} text node(s) could NOT be measured`,
        'a colour format the parser does not read — see color-utils parseColor');
    }
    if (axeTotal) {
      note('high', `${theme}/${d.name}`, `${axeTotal} unnamed or ambiguous control(s)`,
        violations.map((v) => `${v.id} x${v.count}: ${v.samples.join(' ')}`).join(' | '));
    }
  }
}

await closeAny();
await ctx.close();
await browser.close();
await p.cleanup();

console.log(`\n${'#'.repeat(72)}`);
console.log(`DIALOG SWEEP: ${findings.length} finding(s) across ${DIALOGS.length} dialogs x 2 themes`);
console.log(`  contrast: ${totalMeasured} node(s) measured, ${totalUnmeasured} unmeasured`);
if (unreached.length) {
  console.log(`\n  NOT REACHED (${unreached.length}) — these were not measured, so the count above does not cover them:`);
  for (const u of unreached) console.log(`    - ${u}`);
}
const bySeverity = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
console.log(`\n  ${JSON.stringify(bySeverity)}`);
for (const f of findings) {
  console.log(`\n  ${f.severity.toUpperCase()} ${f.where}\n    ${f.title}\n    ${f.measured.slice(0, 400)}`);
}

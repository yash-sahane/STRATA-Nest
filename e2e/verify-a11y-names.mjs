// Are there controls a screen reader cannot name?
//
// Several findings in the low pile claim a specific unnamed button ("the delete (trash)
// button in the requirement detail dialog has no accessible name"). Rather than chase
// them one at a time — and a source grep is unreliable here, because `title` names a
// control just as `aria-label` does — this asks axe across every route, with dialogs
// opened, and reports what is actually unnamed.
//
// Rules chosen for "can this be identified and operated": names for buttons, links and
// inputs, alt text on images, and unique ids (a duplicate id silently breaks the
// label/control pairing).
import { readFileSync } from 'node:fs';
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { createRequire } from 'node:module';

const AXE = readFileSync(
  // Resolved through node's own resolver rather than hard-coded: the suite must not
  // depend on where this checkout happens to live.
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const RULES = ['button-name', 'link-name', 'input-button-name', 'image-alt', 'label', 'duplicate-id-active', 'aria-input-field-name', 'select-name'];

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 500)}`); };

const browser = await chromium.launch();
const p = await provision('a11y');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Enough content that lists, cards and dialogs actually render something.
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'A11y Sprint',
  goal: 'g', startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'A11-R',
  title: 'A11y requirement', clientName: 'A11y Co', priority: 'HIGH', status: 'DRAFT',
});
const fr = await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'A11-FR', title: 'A11y functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
});
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'A11-E',
  name: 'A11y epic', status: 'TODO',
});
await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'A11-T',
  title: 'A11y task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
});

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const runAxe = async () => {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (rules) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'rule', values: rules } });
    return r.violations.map((v) => ({
      id: v.id,
      count: v.nodes.length,
      samples: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 120)),
    }));
  }, RULES);
};

// A violation has to survive a second scan to count.
//
// This check failed once in a suite run and passes 24/24 standalone, and a check that
// flakes is worse than none: the next real regression it catches gets waved off. The
// rules most likely to trip transiently are the ones that need a settled tree --
// `duplicate-id-active` sees one id twice while React holds the outgoing and incoming
// subtree together, and `label`/`button-name` see a skeleton or a control whose text is
// not committed yet. Those clear a frame later. A genuinely unnamed control is unnamed in
// every scan, so "seen twice, across a settle" is a sharper predicate than any single
// scan with any timeout, and it gives up nothing the check could otherwise catch.
const scan = async (label) => {
  const first = await runAxe();
  const firstTotal = first.reduce((a, v) => a + v.count, 0);

  if (firstTotal === 0) {
    console.log(`   ${label.padEnd(38)} clean`);
    return { label, total: 0, violations: [] };
  }

  // Something showed up. Let the tree settle and look again.
  await page.waitForTimeout(1800);
  const second = await runAxe();
  const secondById = new Map(second.map((v) => [v.id, v]));

  const persistent = [];
  const transient = [];
  for (const v of first) {
    const again = secondById.get(v.id);
    if (again) persistent.push({ ...v, count: Math.min(v.count, again.count) });
    else transient.push(v);
  }

  const total = persistent.reduce((a, v) => a + v.count, 0);
  console.log(`   ${label.padEnd(38)} ${total === 0 ? 'clean' : `${total} node(s)`}`);
  for (const v of persistent) {
    console.log(`      ${v.id} x${v.count}`);
    for (const sample of v.samples) console.log(`         ${sample}`);
  }
  // Printed but not counted: a real intermittent problem stays visible.
  for (const v of transient) {
    console.log(`      (transient, gone on re-scan) ${v.id} x${v.count}`);
    for (const sample of v.samples) console.log(`         ${sample}`);
  }
  return { label, total, violations: persistent };
};

const results = [];
for (const route of [
  '/dashboard', '/projects', '/tasks', '/sprints', '/epics', '/requirements',
  '/functional-requirements', '/attendance', '/leave', '/time-tracking', '/team',
  '/analytics', '/activity', '/calendar', '/notifications', '/workspaces',
  '/settings', '/profile',
]) {
  await visit(page, route, 5500);
  results.push(await scan(route));
}

// ---- with dialogs open, which a route scan never reaches ---------------------
console.log('\n===== dialogs');
await visit(page, '/dashboard', 5000);
{
  const bell = page.getByRole('button', { name: /notification/i }).first();
  if (await bell.count()) { await bell.click(); await page.waitForTimeout(2500); }
  results.push(await scan('notification panel'));
  await page.keyboard.press('Escape');
}
// Each entry names itself and states what must be on screen once it is open. Without the
// second part, a click that failed to open anything would leave `scan()` examining the
// bare page, finding it clean, and passing while testing nothing.
for (const [route, opener, label, mustContain] of [
  ['/tasks', /new task|create task/i, '/tasks create dialog', /create task|new task/i],
  ['/epics', /new epic|create epic/i, '/epics create dialog', /create epic|new epic/i],
  ['/sprints', /new sprint|create sprint/i, '/sprints create dialog', /create sprint|new sprint/i],
  ['/requirements', /new client requirement|new requirement/i,
    '/requirements create dialog', /client name|create client requirement/i],
  // The requirement DETAIL dialog, which this list used to skip -- and two of its
  // comboboxes had no accessible name, so a separate dialog sweep had to find them. The
  // label was a bare <label> with no association, and a <label for> does not name a
  // `button`: button's accessible name comes from aria-labelledby, aria-label, contents,
  // then title.
  ['/requirements', /^View Details$/, 'requirement DETAIL dialog', /requirement details|client/i],
]) {
  await visit(page, route, 6000);
  const btn = page.getByRole('button', { name: opener }).first();
  if (!(await btn.count())) {
    rec(false, `${label}: an opener matching ${opener} exists`, 'none matched');
    continue;
  }
  await btn.click();

  // Poll for a visible dialog carrying the expected text, rather than sleeping and hoping.
  let opened = false;
  for (let i = 0; i < 40; i += 1) {
    const text = await page.locator('[role="dialog"]:visible').first().innerText().catch(() => '');
    if (text && mustContain.test(text)) { opened = true; break; }
    await page.waitForTimeout(250);
  }
  if (!opened) {
    const seen = await page.locator('[role="dialog"]:visible').first().innerText().catch(() => '');
    rec(false, `${label}: opened, and is the dialog under test`,
      `expected ${mustContain}; saw ${JSON.stringify(String(seen).slice(0, 160))}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    continue;
  }

  results.push(await scan(label));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}
// The FR detail dialog, which one finding named specifically.
await page.goto(`http://localhost:3000/functional-requirements?frId=${fr.j?.id}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(9000);
results.push(await scan('FR detail dialog'));

const offenders = results.filter((r) => r.total > 0);
console.log(`\n${offenders.length} of ${results.length} screens have an unnamed or ambiguous control`);
rec(offenders.length === 0,
  'every control on every screen can be named by a screen reader',
  offenders
    .map((o) => `${o.label}: ${o.violations.map((v) => `${v.id} x${v.count}`).join(', ')}`)
    .join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

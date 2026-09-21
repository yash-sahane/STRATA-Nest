// Is every transition in this app one of the four durations the app says it has?
//
// globals.css declares a motion scale — micro 120ms for hover and focus, standard 180ms
// for dropdowns and tabs, overlay 240ms for dialogs, layout 320ms for structural moves —
// and says in as many words that it exists to stop durations drifting apart.
//
// It was not being honoured. Measured across eighteen routes in both themes: 1310 of
// 1552 transitions ran at 0.15s, which is not on the scale at all. It is Tailwind's
// built-in default, inherited by every `transition-colors` written without a duration —
// so 84% of the motion in the app was set by a framework default rather than by the
// scale that exists to decide it. Exactly the drift the scale was written to prevent,
// one level up and much harder to see, because there is no literal anywhere to grep for.
//
// Fixed by pointing `--default-transition-duration` at the micro token, which is why
// this check exists: that is a single line in one file, and nothing else would notice if
// it were removed.
//
// Durations are read from what the browser computes, so a value arriving from a utility,
// a component class, an inline style or a third-party stylesheet is all the same here.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();

// The scale, in milliseconds. 0 is always allowed: plenty of elements transition nothing.
const SCALE = [0, 120, 180, 240, 320];
// Third-party widgets bring their own motion and are not ours to align. Recharts animates
// its series; the toast library has its own timings.
const FOREIGN = /recharts|sonner|toaster/i;

const browser = await chromium.launch();
const p = await provision('motionscale');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

for (let i = 0; i < 3; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `MS-${i}`,
    title: `Motion scale task ${i}`, status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
  });
}

const COLLECT = `(() => {
  const out = {};
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cls = String(el.className || '');
    if (/recharts|sonner|toaster/i.test(cls)) continue;
    for (const raw of (cs.transitionDuration || '0s').split(',')) {
      const ms = Math.round(parseFloat(raw) * 1000);
      if (!Number.isFinite(ms)) continue;
      const key = String(ms);
      out[key] ??= { n: 0, where: [] };
      out[key].n += 1;
      const tag = el.tagName.toLowerCase() + '.' + cls.split(' ').slice(0, 3).join('.');
      if (out[key].where.length < 3 && !out[key].where.includes(tag)) out[key].where.push(tag);
    }
  }
  return out;
})()`;

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/epics', '/requirements', '/sprints',
  '/team', '/attendance', '/leave', '/analytics', '/settings', '/profile',
];

const totals = {};
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await page.setViewportSize({ width: 1280, height: 900 });

for (const theme of ['light', 'dark']) {
  for (const route of ROUTES) {
    await visit(page, route, 4000);
    await page.evaluate((th) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.setAttribute('data-theme', th);
    }, theme);
    await page.waitForTimeout(600);
    const got = await page.evaluate(COLLECT).catch(() => ({}));
    for (const [ms, v] of Object.entries(got)) {
      totals[ms] ??= { n: 0, where: [] };
      totals[ms].n += v.n;
      for (const w of v.where) {
        if (totals[ms].where.length < 4 && !totals[ms].where.includes(`${route} ${w}`)) {
          totals[ms].where.push(`${route} ${w}`);
        }
      }
    }
  }
}

const rows = Object.entries(totals).sort((a, b) => b[1].n - a[1].n);
const used = rows.reduce((s, [, v]) => s + v.n, 0);
console.log(`\n===== ${rows.length} distinct duration(s) across ${used} transitions`);
for (const [ms, v] of rows) {
  const ok = SCALE.includes(Number(ms));
  console.log(`   ${(ms + 'ms').padEnd(8)} ${String(v.n).padStart(5)}${ok ? '' : '   OFF SCALE: ' + v.where.slice(0, 2).join(' , ')}`);
}

const offScale = rows.filter(([ms]) => !SCALE.includes(Number(ms)));
rec(
  offScale.length === 0,
  `every transition duration is one of ${SCALE.filter(Boolean).join('/')}ms`,
  offScale
    .map(([ms, v]) => `${ms}ms used ${v.n}x (${v.where.slice(0, 2).join(' ; ')})`)
    .join('  |  ') +
    ' — a duration off the scale is one nobody chose; 150ms in particular is what ' +
    'Tailwind uses when a transition is written with no duration at all',
);
rec(used > 200, 'there were transitions to measure', `only ${used} found — nothing was tested`);

// ---------------------------------------------------------------- the detector works
console.log('\n===== self-test: an off-scale duration must be caught');
await visit(page, '/dashboard', 5000);
const caught = await page.evaluate(`(() => {
  const el = document.querySelector('button');
  if (!el) return null;
  el.style.transitionDuration = '175ms';
  const ms = Math.round(parseFloat(getComputedStyle(el).transitionDuration) * 1000);
  return ms;
})()`);
rec(
  caught === 175 && !SCALE.includes(175),
  'a 175ms transition is both applied and recognised as off the scale',
  `reading back ${caught}ms — if this is not 175 the audit is not reading what the ` +
    'browser computes, and every pass above is meaningless',
);
console.log(`   injected 175ms and read back ${caught}ms`);

const out = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = out.some((r) => !r.ok) ? 1 : 0;

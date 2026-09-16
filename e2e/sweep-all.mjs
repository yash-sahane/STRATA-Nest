// Whole-app sweep. Walks every authenticated route on realistic seeded data, in
// both themes and at two viewports, and reports anything a user would call a
// defect: runtime errors, 5xx, unreadable text, layout that breaks or scrolls
// sideways, controls with no accessible name, and dead-end loading states.
//
//   node sweep-all.mjs            # everything
//   node sweep-all.mjs /tasks     # one route
import { chromium, api, adminJar, provision, signedInPage, visit, BASE } from './kit.mjs';
import { COLLECT_TEXT_NODES, judge } from './color-utils.mjs';

const only = process.argv.slice(2);
const findings = [];
const note = (severity, route, title, measured) => {
  findings.push({ severity, route, title, measured });
  console.log(`  ${severity.toUpperCase().padEnd(8)} ${title}\n           ${measured}`);
};

/** Layout, naming and dead-state problems, measured in-page. */
const AUDIT = `(() => {
  const doc = document.documentElement;
  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="combobox"], input, select, textarea')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const name = (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') ? 'labelledby' : '') ||
      (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent) ||
      el.closest('label')?.textContent ||
      el.textContent ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      ''
    ).trim();
    if (!name) unnamed.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
  }
  // Anything sticking out past the right edge of the viewport.
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > doc.clientWidth + 4) {
      overflowing.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 30) });
      if (overflowing.length > 4) break;
    }
  }
  const body = document.body.innerText || '';
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    unnamed: [...new Set(unnamed)].slice(0, 6),
    unnamedCount: unnamed.length,
    overflowing,
    stillLoading: /Loading\\.\\.\\.|Loading…/.test(body) ? body.match(/Loading[^\\n]{0,30}/)?.[0] : null,
    bodyStart: body.replace(/\\s+/g, ' ').slice(0, 120),
  };
})()`;

// ------------------------------------------------------------------- setup
const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('sweep');
console.log(`workspace ${p.ws} / project ${p.project}\n`);

// Seed something realistic so no screen is measured empty.
const epic = (await api(admin, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SW-E1', name: 'Checkout Rework',
  description: 'Rebuild the checkout funnel', status: 'IN_PROGRESS', progress: 40,
  startDate: '2026-09-01', endDate: '2026-12-01',
})).j;
const cr = (await api(admin, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, title: 'Customers can pay by card',
  description: 'Card payments end to end', priority: 'HIGH', status: 'APPROVED',
})).j;
const fr = (await api(admin, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SW-FR1', title: 'Card capture form',
  clientRequirementId: cr?.id, epicId: epic?.id, status: 'IMPLEMENTED', progress: 60, complexity: 'HIGH',
})).j;
const sprint = (await api(admin, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Sprint 14', goal: 'Ship card capture',
  startDate: '2026-09-07', endDate: '2026-09-21', status: 'ACTIVE',
})).j;
const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW'];
const tasks = [];
for (let i = 0; i < 14; i += 1) {
  const t = (await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `SW-T${i}`,
    title: `Sweep task ${i} — card capture work item`, description: 'Seeded for the sweep',
    status: STATUSES[i % STATUSES.length], priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4],
    epicId: epic?.id, sprintId: i % 2 ? sprint?.id : undefined,
    functionalRequirementId: i % 3 ? fr?.id : undefined,
    estimatedHours: i === 0 ? 0 : i,
  })).j;
  if (t?.id) tasks.push(t);
}
for (let i = 0; i < 4; i += 1) {
  await api(admin, 'POST', '/task_comments', { taskId: tasks[0]?.id, content: `Seeded comment ${i}` });
}
const now = Date.now();
for (let i = 0; i < 6; i += 1) {
  await api(admin, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, taskId: tasks[i]?.id,
    description: `Seeded entry ${i}`,
    startTime: new Date(now - (i + 2) * 3600e3).toISOString(),
    endTime: new Date(now - (i + 1) * 3600e3).toISOString(),
    isBillable: i % 2 === 0,
  });
}
console.log(`seeded: 1 epic, 1 CR, 1 FR, 1 sprint, ${tasks.length} tasks, 4 comments, 6 time entries\n`);

const ROUTES = [
  '/dashboard', '/projects', `/projects/${p.project}`, `/projects/${p.project}/settings`,
  '/requirements', '/functional-requirements', '/epics', '/sprints',
  `/sprints/${sprint?.id}/board`, `/sprints/${sprint?.id}/backlog`, `/sprints/${sprint?.id}/analytics`,
  '/tasks', '/team', '/attendance', '/time-tracking', '/leave',
  '/calendar', '/activity', '/analytics', '/workspaces', '/settings', '/profile',
].filter((r) => !only.length || only.some((o) => r.includes(o)));

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 950 },
  { name: 'phone', width: 390, height: 844 },
];

// ------------------------------------------------------------------- sweep
for (const theme of ['dark', 'light']) {
  for (const vp of VIEWPORTS) {
    const { ctx, page, errors, consoleErrors, failedRequests } = await signedInPage(
      browser, 'admin@strata.local', p.ws, { viewport: { width: vp.width, height: vp.height } },
    );
    await page.evaluate((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);

    for (const route of ROUTES) {
      errors.length = 0; consoleErrors.length = 0; failedRequests.length = 0;
      console.log(`\n[${theme}/${vp.name}] ${route}`);
      try {
        await visit(page, route, 3200);
      } catch (e) {
        note('high', route, `${theme}/${vp.name}: navigation threw`, String(e).slice(0, 160));
        continue;
      }

      if (errors.length) note('critical', route, `${theme}/${vp.name}: uncaught page error`, errors.slice(0, 2).join(' | '));
      const realConsole = consoleErrors.filter((c) => !/401 \(Unauthorized\)|Download the React DevTools/i.test(c));
      if (realConsole.length) note('high', route, `${theme}/${vp.name}: console error`, realConsole.slice(0, 2).join(' | '));
      const server = failedRequests.filter((f) => /HTTP 5\d\d/.test(f));
      if (server.length) note('critical', route, `${theme}/${vp.name}: server error`, server.slice(0, 2).join(' | '));

      const a = await page.evaluate(AUDIT).catch(() => null);
      if (!a) { note('medium', route, `${theme}/${vp.name}: audit could not run`, 'page.evaluate failed'); continue; }

      if (a.scrollWidth > a.clientWidth + 4) {
        note('high', route, `${theme}/${vp.name}: page scrolls horizontally`,
          `scrollWidth ${a.scrollWidth} vs clientWidth ${a.clientWidth}; widest: ${JSON.stringify(a.overflowing.slice(0, 2))}`);
      }
      if (a.unnamedCount) {
        note('medium', route, `${theme}/${vp.name}: ${a.unnamedCount} control(s) with no accessible name`, a.unnamed.join(', '));
      }
      if (a.stillLoading) {
        note('high', route, `${theme}/${vp.name}: still loading after settle`, `"${a.stillLoading}" — ${a.bodyStart}`);
      }

      // Contrast only needs measuring once per theme; the phone pass repeats it.
      if (vp.name === 'desktop') {
        const nodes = await page.evaluate(COLLECT_TEXT_NODES).catch(() => []);
        const bad = [];
        const unmeasured = [];
        let measured = 0;
        for (const n of nodes) {
          const v = judge(n);            // null = deliberately not judged (see color-utils)
          if (!v) continue;
          // A colour the parser cannot read used to vanish here: judge returned null and
          // `if (v && !v.passes)` made it indistinguishable from a pass. Tailwind v4's
          // default palette is written as lab(), which getComputedStyle returns verbatim,
          // so every raw-palette element was skipped while the tally below claimed to
          // cover the page. Counted now, so silence cannot pass for success.
          if (v.unmeasured) { unmeasured.push({ ...n, why: v.unmeasured }); continue; }
          measured += 1;
          if (!v.passes) bad.push({ ...n, ...v, c: Number(v.ratio.toFixed(2)) });
        }
        console.log(`           contrast: ${measured} node(s) measured, ${bad.length} under floor, ${unmeasured.length} unmeasured`);
        const worst = bad.sort((x, y) => x.c - y.c).slice(0, 3);
        if (worst.length) {
          note('medium', route, `${theme}: ${bad.length} of ${measured} text node(s) under contrast floor`,
            worst.map((w) => `${w.c}:1 (needs ${w.floor}) rgb(${w.fg}) on rgb(${w.bg}) "${w.text}" <${w.tag} class="${w.cls}">`).join(' | '));
        }
        if (unmeasured.length) {
          note('high', route, `${theme}: ${unmeasured.length} text node(s) could NOT be measured for contrast`,
            unmeasured.slice(0, 3)
              .map((u) => `${u.why} fg=${u.fg} "${String(u.text).slice(0, 30)}" <${u.tag} class="${u.cls}">`)
              .join(' | '));
        }
      }
    }
    await ctx.close();
  }
}

await browser.close();
await p.cleanup();

// ------------------------------------------------------------------ report
console.log(`\n${'#'.repeat(72)}`);
const by = {};
findings.forEach((f) => (by[f.severity] = (by[f.severity] || 0) + 1));
console.log(`SWEEP: ${findings.length} findings over ${ROUTES.length} routes x 2 themes x 2 viewports`);
console.log(JSON.stringify(by));
for (const sev of ['critical', 'high', 'medium', 'low']) {
  const rows = findings.filter((f) => f.severity === sev);
  if (!rows.length) continue;
  console.log(`\n--- ${sev.toUpperCase()} (${rows.length})`);
  rows.forEach((r) => console.log(`  ${r.route}\n    ${r.title}\n    ${r.measured}`));
}
const fs = await import('node:fs');
fs.writeFileSync(new URL('./sweep-findings.json', import.meta.url), JSON.stringify(findings, null, 2));
console.log('\nwritten to sweep-findings.json');

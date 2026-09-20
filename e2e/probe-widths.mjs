// The widths nobody has looked at.
//
// The suite tests 320px (WCAG reflow), 390px (a phone) and 1280px (a laptop). Everything
// between is where the layout actually CHANGES: Tailwind switches at 640, 768, 1024 and
// 1280, and a grid that goes from one column to three does it at a specific pixel. The
// interesting width is the one just BELOW a breakpoint, where the wide layout has not
// engaged yet but the content is already being asked to fit.
//
// A tablet in portrait is 768 and in landscape 1024. A split-screen laptop window is
// around 640. None of those has ever been rendered in this suite.
//
// Reports rather than asserts: a sideways scroll on a data table is usually correct, and
// telling the two apart needs the numbers in front of you.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const browser = await chromium.launch();
const p = await provision('widths');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const mgrId = await whoami(mgr);

// Enough content that the layouts have something to lay out.
for (let i = 0; i < 6; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `W-${i}`,
    title: `Width probe task ${i} with a reasonably descriptive name`,
    status: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'][i % 5],
    priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4],
    assigneeIds: [mgrId],
  });
}
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'W-E1', name: 'Width probe epic',
});
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Width probe sprint',
  startDate: '2026-10-01', endDate: '2026-10-14',
});

// Just below each Tailwind breakpoint, plus the breakpoint itself where it matters.
const WIDTHS = [320, 639, 768, 1023, 1440];
const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/epics', '/sprints',
  '/team', '/attendance', '/analytics', '/settings', '/profile',
];

/**
 * Overflow that a person cannot get to, and controls that sit on top of each other.
 *
 * A wide table inside an overflow-x:auto wrapper is past the edge BY DESIGN and perfectly
 * reachable, so it is not reported — otherwise the real findings drown.
 */
const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { pageScroll: Math.max(0, document.documentElement.scrollWidth - vw), past: [], overlap: [] };
  const label = (el) => {
    const cls = String(el.className || '').split(' ').slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  };
  const reachable = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const ov = getComputedStyle(n).overflowX;
      if (ov === 'auto' || ov === 'scroll') return n.scrollWidth > n.clientWidth + 2;
    }
    return false;
  };

  const controls = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > vw + 2 && el.children.length === 0 && !reachable(el)) {
      out.past.push({ at: Math.round(r.right - vw), what: label(el) });
    }
    if (/^(button|a|input|select|textarea)$/.test(el.tagName.toLowerCase()) && r.width > 8) {
      controls.push({ r, el });
    }
  }

  // Two controls sharing pixels is a layout that has run out of room, not a design.
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].r, b = controls[j].r;
      if (controls[i].el.contains(controls[j].el) || controls[j].el.contains(controls[i].el)) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4) {
        out.overlap.push({ by: Math.round(ox) + 'x' + Math.round(oy), a: label(controls[i].el), b: label(controls[j].el) });
      }
    }
  }
  out.past = out.past.slice(0, 4);
  out.overlap = out.overlap.slice(0, 4);
  return out;
})()`;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  console.log(`\n===== ${width}px`);
  for (const route of ROUTES) {
    await visit(page, route, 5000);
    const a = await page.evaluate(AUDIT).catch(() => null);
    if (!a) {
      console.log(`   ${route.padEnd(13)} audit could not run`);
      continue;
    }
    const bits = [];
    if (a.pageScroll > 0) bits.push(`page scrolls ${a.pageScroll}px sideways`);
    if (a.past.length) bits.push(`${a.past.length} unreachable past the edge`);
    if (a.overlap.length) bits.push(`${a.overlap.length} overlapping control(s)`);
    console.log(`   ${route.padEnd(13)} ${bits.length ? bits.join(', ') : 'clean'}`);
    for (const x of a.past) console.log(`       +${x.at}px  ${x.what}`);
    for (const x of a.overlap) console.log(`       overlap ${x.by}  ${x.a}  <>  ${x.b}`);
  }
}

await ctx.close();
await browser.close();
await p.cleanup();

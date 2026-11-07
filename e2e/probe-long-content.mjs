// What does the UI do with the longest content the API will actually accept?
//
// Every screen in this suite has only ever been looked at with short, tidy names —
// "Volume task 4", "QA Client". The DTOs accept a great deal more: a task title may be
// 500 characters, a project or workspace name 255, a label 100. Those are not abusive
// inputs, they are the documented limit, and a real team WILL paste a sentence into a
// title field.
//
// The classic breaker is not length on its own but length with NO SPACES — a pasted URL,
// a stack trace, a German compound. `truncate` handles a long sentence; an unbroken
// string needs `break-words` or it pushes its container wide and drags the layout with it.
//
// Reconnaissance, not an assertion: this prints what it finds so the real defects can be
// told apart from the places the design already handles gracefully.
import { chromium, api, provision, addRole, signedInPage, visit } from './kit.mjs';

const browser = await chromium.launch();
const p = await provision('longcontent');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

// At the documented maximum, and one of each shape.
const SENTENCE = ('Quarterly platform migration and data reconciliation across every '
  + 'downstream consumer including the billing pipeline ').repeat(4).slice(0, 495);
const UNBROKEN = 'https://internal.example.com/runbooks/incident/' + 'x'.repeat(140);

console.log(`   sentence title: ${SENTENCE.length} chars`);
console.log(`   unbroken title: ${UNBROKEN.length} chars, no spaces after the scheme`);

const mk = async (path, body) => {
  const r = await api(mgr, 'POST', path, body);
  if (r.s >= 400) console.log(`   ! ${path} refused: ${r.s} ${String(r.t).slice(0, 120)}`);
  return r.j;
};

await mk('/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'LONG-1',
  title: SENTENCE, status: 'TODO', priority: 'HIGH',
});
await mk('/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'LONG-2',
  title: UNBROKEN, status: 'IN_PROGRESS', priority: 'CRITICAL',
});
const epic = await mk('/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'LONG-E1',
  name: SENTENCE.slice(0, 200), status: 'TODO',
});
await mk('/client_requirements', {
  workspaceId: p.ws, projectId: p.project,
  title: UNBROKEN.slice(0, 200), description: SENTENCE, clientName: UNBROKEN.slice(0, 80),
});
await mk('/sprints', {
  workspaceId: p.ws, projectId: p.project,
  name: SENTENCE.slice(0, 150), goal: UNBROKEN,
  startDate: '2026-10-01', endDate: '2026-10-14',
});

// The project and workspace names frame every page.
await api(mgr, 'PATCH', `/projects/${p.project}`, { name: SENTENCE.slice(0, 250) });
await api(p.admin, 'PATCH', `/workspaces/${p.ws}`, { name: UNBROKEN.slice(0, 120) });

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

/** Anything that reaches past the viewport, or is silently cut with no ellipsis. */
const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { pageScroll: 0, past: [], clipped: [] };
  out.pageScroll = Math.max(0, document.documentElement.scrollWidth - vw);

  const label = (el) => {
    const cls = String(el.className || '').split(' ').slice(0, 2).join('.');
    const text = (el.textContent || '').trim().slice(0, 40);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' "' + text + '"';
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    // Reaches past the right edge of the page AND cannot be scrolled to. A wide table
    // inside an overflow-x:auto wrapper is past the edge by design and perfectly
    // reachable; reporting it would bury the real thing under a list of correct ones.
    if (r.right > vw + 2 && el.children.length === 0) {
      let reachable = false;
      for (let n = el.parentElement; n && !reachable; n = n.parentElement) {
        const ov = getComputedStyle(n).overflowX;
        if (ov === 'auto' || ov === 'scroll') reachable = n.scrollWidth > n.clientWidth + 2;
        if (ov === 'auto' || ov === 'scroll') break;
      }
      if (!reachable) out.past.push({ at: Math.round(r.right - vw), what: label(el) });
    }

    // Cut off with nothing to say so. overflow:hidden plus ellipsis is a deliberate
    // truncation and reads fine; overflow:hidden WITHOUT it just loses the text.
    const hiddenX = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
    const ellipsis = cs.textOverflow === 'ellipsis';
    if (hiddenX && !ellipsis && el.scrollWidth > el.clientWidth + 4 && el.children.length === 0) {
      out.clipped.push({ by: el.scrollWidth - el.clientWidth, what: label(el) });
    }
  }
  out.past = out.past.slice(0, 6);
  out.clipped = out.clipped.slice(0, 6);
  return out;
})()`;

const ROUTES = ['/dashboard', '/projects', '/tasks', '/epics', '/requirements', '/sprints', '/team'];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  console.log(`\n===== ${vp.name} (${vp.width}px)`);
  for (const route of ROUTES) {
    await visit(page, route, 6000);
    const a = await page.evaluate(AUDIT).catch(() => null);
    if (!a) {
      console.log(`   ${route.padEnd(15)} audit could not run`);
      continue;
    }
    const bits = [];
    if (a.pageScroll > 0) bits.push(`page scrolls ${a.pageScroll}px sideways`);
    if (a.past.length) bits.push(`${a.past.length} element(s) past the edge`);
    if (a.clipped.length) bits.push(`${a.clipped.length} clipped with no ellipsis`);
    console.log(`   ${route.padEnd(15)} ${bits.length ? bits.join(', ') : 'clean'}`);
    for (const x of a.past) console.log(`       +${x.at}px  ${x.what}`);
    for (const x of a.clipped) console.log(`       cut ${x.by}px  ${x.what}`);
  }
}

await ctx.close();
await browser.close();
await p.cleanup();

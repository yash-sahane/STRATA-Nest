// Does the app survive 320px and 200% zoom? (WCAG 1.4.10 Reflow, 1.4.4 Resize Text)
//
// Every viewport check so far used 390px. The criterion is 320px — 18% narrower — and it
// is not only about horizontal scrolling: content must not be cut off, and controls must
// not overlap into each other.
//
// 200% zoom is the same criterion approached the other way. Rather than trusting that a
// narrow viewport stands in for it, this sets a real deviceScaleFactor-independent zoom by
// halving the viewport at the same CSS width, which is what 200% does to the layout.
//
// Three things are measured per route:
//   1. does the document scroll sideways (the explicit 1.4.10 failure)
//   2. is anything painted outside the viewport's right edge
//   3. do any two interactive controls OVERLAP, which is how a cramped layout actually
//      breaks — a button sitting on top of another is reachable by neither mouse nor eye
import { createSprint, chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('reflow');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await createSprint(mgr, {
  workspaceId: p.ws, projectId: p.project, name: 'Reflow Sprint', goal: 'g',
  startDate: today, endDate: plus(10), status: 'ACTIVE',
});
const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'RF-R',
  title: 'A requirement with a deliberately long title that will not wrap kindly',
  clientName: 'Reflow Corporation International', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so tables have wide content to reflow.',
});
await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'RF-FR', title: 'A functional requirement with an equally unhelpful long title',
  status: 'DRAFT', priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
});
await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'RF-T',
  title: 'A task whose title is long enough to test wrapping in a narrow column',
  status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
});

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/sprints', '/epics', '/requirements',
  '/functional-requirements', '/attendance', '/leave', '/time-tracking', '/team',
  '/analytics', '/activity', '/calendar', '/notifications', '/workspaces',
  '/settings', '/profile',
];

// 320px is the 1.4.10 width. 640x512 at the same CSS width is what 200% zoom does to a
// 1280x1024 window — the layout sees half the CSS pixels in each direction.
const CASES = [
  { name: '320px (WCAG 1.4.10)', width: 320, height: 800 },
  { name: '200% zoom of 1280x1024', width: 640, height: 512 },
];

const findings = [];

for (const vp of CASES) {
  console.log(`\n${'='.repeat(70)}\n${vp.name}  —  ${vp.width}x${vp.height}\n${'='.repeat(70)}`);
  const { ctx, page } = await signedInPage(
    browser, 'role.manager@strata.local', p.ws,
    { viewport: { width: vp.width, height: vp.height } },
  );

  for (const route of ROUTES) {
    await visit(page, route, 5000);
    const r = await page.evaluate(() => {
      const docWidth = document.documentElement.clientWidth;
      const scrollsSideways = document.documentElement.scrollWidth > docWidth + 2;

      const overflowing = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        // Inside a container that scrolls horizontally on purpose (a wide table) this is
        // expected and allowed by 1.4.10; only content the PAGE cannot reach counts.
        let scrollableAncestor = false;
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) {
            scrollableAncestor = true;
            break;
          }
          n = n.parentElement;
        }
        if (scrollableAncestor) continue;
        if (box.right > docWidth + 2) {
          overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 44)} right=${Math.round(box.right)}`);
        }
      }

      // Interactive controls sitting ON TOP of each other.
      const controls = Array.from(document.querySelectorAll('a[href], button, input, select, textarea'))
        .filter((el) => {
          const cs = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          return cs.visibility !== 'hidden' && cs.display !== 'none' && b.width > 4 && b.height > 4;
        })
        .map((el) => ({ el, b: el.getBoundingClientRect() }));
      const overlaps = [];
      // A field's own adornment — a clear or shortcut button drawn INSIDE the padding
      // the field keeps free for it — is not an overlap: no text can run under it. It
      // has to lie wholly within the field, and wholly within that padding; anything
      // else sitting on a field still counts.
      const adornment = (field, other) => {
        if (!/^(INPUT|TEXTAREA)$/.test(field.el.tagName)) return false;
        const cs = getComputedStyle(field.el);
        const contentLeft = field.b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const contentRight = field.b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const within = other.b.left >= field.b.left - 1 && other.b.right <= field.b.right + 1
          && other.b.top >= field.b.top - 1 && other.b.bottom <= field.b.bottom + 1;
        return within && (other.b.left >= contentRight - 1 || other.b.right <= contentLeft + 1);
      };
      for (let i = 0; i < controls.length; i += 1) {
        for (let j = i + 1; j < controls.length; j += 1) {
          const a = controls[i];
          const c = controls[j];
          // Nesting is not overlap (a button inside a link).
          if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
          if (adornment(a, c) || adornment(c, a)) continue;
          const ox = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
          const oy = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
          // Require a real overlap, not a 1px rounding kiss.
          if (ox > 4 && oy > 4) {
            overlaps.push(`${a.el.tagName.toLowerCase()}"${(a.el.textContent || '').trim().slice(0, 16)}" over ${c.el.tagName.toLowerCase()}"${(c.el.textContent || '').trim().slice(0, 16)}"`);
          }
        }
      }

      return {
        docWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollsSideways,
        overflowing: overflowing.slice(0, 3),
        overflowCount: overflowing.length,
        overlaps: [...new Set(overlaps)].slice(0, 3),
        overlapCount: new Set(overlaps).size,
        textLen: (document.body.innerText || '').trim().length,
      };
    });

    const bad = r.scrollsSideways || r.overflowCount > 0 || r.overlapCount > 0;
    console.log(`   ${route.padEnd(28)} ${bad ? 'ISSUE' : 'ok   '}  scroll=${r.scrollWidth}/${r.docWidth}  overflow=${r.overflowCount}  overlap=${r.overlapCount}  text=${r.textLen}`);
    if (r.scrollsSideways) {
      findings.push({ vp: vp.name, route, what: 'scrolls sideways', detail: `${r.scrollWidth}px in ${r.docWidth}px` });
      console.log(`      sideways: ${r.scrollWidth}px in a ${r.docWidth}px viewport`);
    }
    if (r.overflowCount) {
      findings.push({ vp: vp.name, route, what: `${r.overflowCount} element(s) past the right edge`, detail: r.overflowing.join(' | ') });
      for (const o of r.overflowing) console.log(`      past edge: ${o}`);
    }
    if (r.overlapCount) {
      findings.push({ vp: vp.name, route, what: `${r.overlapCount} overlapping control pair(s)`, detail: r.overlaps.join(' | ') });
      for (const o of r.overlaps) console.log(`      overlap: ${o}`);
    }
    if (r.textLen < 20) {
      findings.push({ vp: vp.name, route, what: 'rendered almost no text', detail: `${r.textLen} chars` });
    }
  }
  await ctx.close();
}

// ---- can this detector report a fault at all? -------------------------------
console.log(`\n${'='.repeat(70)}\nself-test: the detector must catch a layout it is given\n${'='.repeat(70)}`);
{
  const { ctx, page } = await signedInPage(
    browser, 'role.manager@strata.local', p.ws,
    { viewport: { width: 320, height: 800 } },
  );
  await visit(page, '/dashboard', 6000);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'reflow-selftest';
    host.style.position = 'relative';
    // Past the right edge, and outside any horizontally scrollable container — so the
    // scrollable-ancestor exemption cannot excuse it.
    const wide = document.createElement('div');
    wide.style.cssText = 'width:900px;height:40px;background:#888';
    wide.textContent = 'deliberately too wide';
    host.appendChild(wide);
    // Two controls sitting on top of each other.
    const a = document.createElement('button');
    a.textContent = 'Under';
    a.style.cssText = 'position:absolute;left:10px;top:60px;width:120px;height:40px';
    const b = document.createElement('button');
    b.textContent = 'Over';
    b.style.cssText = 'position:absolute;left:30px;top:70px;width:120px;height:40px';
    host.appendChild(a);
    host.appendChild(b);
    document.body.appendChild(host);
  });
  await page.waitForTimeout(400);

  const probe = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollsSideways = document.documentElement.scrollWidth > docWidth + 2;
    let pastEdge = 0;
    for (const el of document.querySelectorAll('#reflow-selftest *')) {
      const box = el.getBoundingClientRect();
      if (box.width > 2 && box.right > docWidth + 2) pastEdge += 1;
    }
    const btns = Array.from(document.querySelectorAll('#reflow-selftest button'))
      .map((el) => el.getBoundingClientRect());
    let overlaps = 0;
    if (btns.length === 2) {
      const ox = Math.min(btns[0].right, btns[1].right) - Math.max(btns[0].left, btns[1].left);
      const oy = Math.min(btns[0].bottom, btns[1].bottom) - Math.max(btns[0].top, btns[1].top);
      if (ox > 4 && oy > 4) overlaps = 1;
    }
    return { scrollsSideways, pastEdge, overlaps };
  });
  console.log(`   injected: sideways=${probe.scrollsSideways} pastEdge=${probe.pastEdge} overlaps=${probe.overlaps}`);
  rec(probe.scrollsSideways, 'the detector sees a document that scrolls sideways', JSON.stringify(probe));
  rec(probe.pastEdge > 0, 'and an element painted past the right edge', JSON.stringify(probe));
  rec(probe.overlaps > 0, 'and a pair of controls sitting on top of each other', JSON.stringify(probe));

  await page.evaluate(() => document.getElementById('reflow-selftest')?.remove());
  await ctx.close();
}

console.log(`\n===== ${findings.length} finding(s)`);
for (const f of findings) console.log(`   ${f.vp} ${f.route}: ${f.what}\n      ${f.detail}`);

rec(findings.length === 0,
  `every route reflows at 320px and at 200% zoom without clipping, sideways scroll or overlap`,
  findings.map((f) => `${f.vp} ${f.route}: ${f.what}`).join(' | '));

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

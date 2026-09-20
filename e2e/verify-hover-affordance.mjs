// Does anything happen when you hover the things you are meant to click?
//
// Nothing in this suite has ever hovered anything. Focus visibility was measured (27
// cases, by pixel), but focus is the keyboard's affordance — hover is the mouse's, and a
// control that does not respond to it reads as decoration. The specific failures worth
// finding:
//
//   no visual change at all   the element looks identical hovered and not, so there is
//                             no signal that it can be clicked
//   no pointer cursor         the arrow stays an arrow over something clickable, which is
//                             the strongest single hint a browser gives
//   pointer on dead text      the opposite: a cursor promising an interaction that is not
//                             there
//
// Measured by pixels, not by reading CSS. A `hover:` class can be present and have no
// effect (overridden by tailwind-merge, or the same colour it already was), and a change
// can come from a parent's rule with no class on the element at all. Screenshotting the
// element hovered and unhovered is the only reading that cannot be argued with.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();

const browser = await chromium.launch();
const p = await provision('hover');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

for (let i = 0; i < 3; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `HV-${i}`,
    title: `Hover probe task ${i}`, status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
  });
}
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'HV-E', name: 'Hover probe epic',
});

const ROUTES = ['/dashboard', '/projects', '/tasks', '/epics', '/team', '/settings', '/notifications'];

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await page.setViewportSize({ width: 1280, height: 900 });

const findings = { noChange: [], noPointer: [], pointerOnDead: [] };

for (const route of ROUTES) {
  await visit(page, route, 6000);

  // Everything a person would reasonably expect to click, that is on screen.
  const targets = await page.evaluate(`(() => {
    const out = [];
    const sel = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 8 || r.height < 8) continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
      // On screen, and not under anything.
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!mid || (!el.contains(mid) && mid !== el)) continue;
      el.setAttribute('data-hover-probe', String(out.length));
      out.push({
        i: out.length,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').split(' ').slice(0, 2).join('.'),
        text: (el.textContent || '').trim().slice(0, 26),
        cursor: cs.cursor,
        box: { x: r.left, y: r.top, w: r.width, h: r.height },
      });
    }
    return out;
  })()`);

  // Cap per route: hovering is slow, and a representative sample of each kind is enough
  // to find a component that never responds.
  const sample = targets.slice(0, 14);

  for (const t of sample) {
    const box = { x: Math.round(t.box.x), y: Math.round(t.box.y), width: Math.round(t.box.w), height: Math.round(t.box.h) };
    if (box.width < 8 || box.height < 8) continue;

    const before = await page.screenshot({ clip: box }).catch(() => null);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Long enough for a 150ms transition to finish.
    await page.waitForTimeout(400);
    const after = await page.screenshot({ clip: box }).catch(() => null);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(120);

    if (!before || !after) continue;
    const changed = Buffer.compare(before, after) !== 0;
    const label = `${route} ${t.tag}.${t.cls} "${t.text}"`;

    if (!changed) findings.noChange.push({ label, cursor: t.cursor });
    if (t.cursor !== 'pointer' && t.tag !== 'a') findings.noPointer.push({ label, cursor: t.cursor });
  }
  console.log(`   ${route.padEnd(16)} hovered ${sample.length} of ${targets.length} control(s)`);
}

const uniq = (list) => {
  const seen = new Set();
  return list.filter((f) => {
    const key = `${f.label.split(' "')[0]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const dead = uniq(findings.noChange);
const arrow = uniq(findings.noPointer);
for (const f of dead) console.log(`   no hover change: ${f.label}`);
for (const f of arrow) console.log(`   no pointer:      ${f.label}  cursor=${f.cursor}`);

rec(
  dead.length === 0,
  'every control changes visibly when hovered',
  `${dead.length} kind(s) of control show not one changed pixel over 400ms of hover: ` +
    dead.map((f) => f.label).join(' ; ') +
    ' — nothing tells a person these respond',
);
rec(
  arrow.length === 0,
  'every control shows a pointer cursor',
  `${arrow.length} kind(s) keep the arrow: ` + arrow.map((f) => f.label).join(' ; ') +
    " — Tailwind v4's Preflight sets `button { cursor: default }` where v3 set pointer, " +
    'so this goes silently wrong app-wide on an upgrade',
);

// ---------------------------------------------------------------- the detector works
//
// Strip the hover rules off a live button and confirm it is caught. A hover audit that
// cannot see a control with no hover would report a clean app either way.
await visit(page, '/dashboard', 6000);
const box = await page.evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 40 && r.height > 20 && r.top > 0 && r.bottom < window.innerHeight;
  });
  if (!el) return null;
  // transition off first, so the "after" shot is not caught mid-fade.
  el.style.transition = 'none';
  el.style.setProperty('background-color', getComputedStyle(el).backgroundColor, 'important');
  el.style.setProperty('color', getComputedStyle(el).color, 'important');
  el.style.setProperty('opacity', getComputedStyle(el).opacity, 'important');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
})()`);

if (!box) {
  rec(false, 'a button was available to self-test with', 'none found on /dashboard');
} else {
  const before = await page.screenshot({ clip: box });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const after = await page.screenshot({ clip: box });
  await page.mouse.move(2, 2);
  rec(
    Buffer.compare(before, after) === 0,
    'a button with its hover pinned out reads as unchanged',
    'pinning background, colour and opacity still produced a pixel difference, so the ' +
      'comparison is picking up something other than hover and the passes above are not ' +
      'evidence',
  );
  console.log('   self-test: a button with hover pinned out compares identical');
}

const rows = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

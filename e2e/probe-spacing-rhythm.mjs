// Is the spacing in this app on a grid, or is it whatever each page felt like?
//
// A padding of 13px or a gap of 7px cannot come from Tailwind's spacing scale, so it came
// from an arbitrary value somebody typed, and it will not line up with anything beside
// it. Those are cheap to find and cheap to fix, and they are the difference between a
// layout that feels settled and one that feels slightly off without anyone being able to
// say why.
//
// Result, for the record: none. Across thirteen routes, every padding, gap and margin the
// app paints is a value the scale can produce.
//
// Two things are counted separately, because they are different problems:
//
//   off-scale  a value Tailwind's spacing scale cannot produce, so somebody typed it.
//   rare       a value that IS on the scale but is used two or three times against
//              hundreds. Usually fine — a one-off gap in a specific layout — but it is
//              where an inconsistency hides when there is one.
//
// The scale is NOT simply multiples of four, which is what the first version of this
// probe assumed. It has half-steps below 4 — 0.5, 1.5, 2.5, 3.5 give 2, 6, 10 and 14px —
// and on that rule it flagged 2px, 6px and 10px paddings as arbitrary when every one of
// them is `py-0.5`, `py-1.5` and `px-2.5`. Reporting standard utilities as defects is
// worse than reporting nothing.
//
// Percentages, `auto` and zero are ignored: a percentage is a layout decision rather
// than a spacing one, and zero is not a spacing choice at all.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

// Tailwind's spacing scale in pixels at a 16px root: half-steps up to 3.5, whole steps
// after that. Written out rather than computed, so it is obvious what is being compared.
const SCALE = new Set([
  2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96, 112, 128,
  144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384,
]);

const browser = await chromium.launch();
const p = await provision('spacing');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

for (let i = 0; i < 4; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `SP-${i}`,
    title: `Spacing probe task ${i}`, status: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'][i],
    priority: 'HIGH', assigneeIds: [mgrId],
  });
}
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SP-E', name: 'Spacing probe epic',
});

const COLLECT = `(() => {
  const out = { padding: {}, gap: {}, margin: {} };
  const bump = (m, px, tag) => {
    if (!Number.isFinite(px) || px <= 0) return;
    const k = String(Math.round(px));
    m[k] ??= { n: 0, where: [] };
    m[k].n += 1;
    if (m[k].where.length < 3 && !m[k].where.includes(tag)) m[k].where.push(tag);
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cls = String(el.className || '');
    // Third-party widgets bring their own spacing and are not ours to align.
    if (/recharts|sonner|toaster|rdp/i.test(cls)) continue;
    // An SVG's className is an SVGAnimatedString, not a string, so the test above never
    // matched inside a chart — which is how two chart labels turned up as 241px and
    // 255px margins. Charts bring their own geometry and are not ours to align.
    if (el.ownerSVGElement || el.tagName === 'svg') continue;
    const tag = el.tagName.toLowerCase() + (cls ? '.' + cls.split(' ').slice(0, 2).join('.') : '');

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      bump(out.padding, parseFloat(cs['padding' + side]), tag);
      const m = parseFloat(cs['margin' + side]);
      if (Number.isFinite(m) && m > 0) bump(out.margin, m, tag);
    }
    if (cs.display === 'flex' || cs.display === 'grid' ||
        cs.display === 'inline-flex' || cs.display === 'inline-grid') {
      bump(out.gap, parseFloat(cs.rowGap), tag);
      bump(out.gap, parseFloat(cs.columnGap), tag);
    }
  }
  return out;
})()`;

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/epics', '/requirements', '/sprints',
  '/team', '/attendance', '/time-tracking', '/leave', '/analytics', '/settings', '/profile',
];

const totals = { padding: {}, gap: {}, margin: {} };
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await page.setViewportSize({ width: 1280, height: 900 });

for (const route of ROUTES) {
  await visit(page, route, 4500);
  const got = await page.evaluate(COLLECT).catch(() => null);
  if (!got) continue;
  for (const kind of Object.keys(totals)) {
    for (const [px, v] of Object.entries(got[kind])) {
      totals[kind][px] ??= { n: 0, where: [] };
      totals[kind][px].n += v.n;
      for (const w of v.where) {
        const tagged = `${route} ${w}`;
        if (totals[kind][px].where.length < 4) totals[kind][px].where.push(tagged);
      }
    }
  }
}

const report = (kind) => {
  const rows = Object.entries(totals[kind]).sort((a, b) => Number(a[0]) - Number(b[0]));
  const total = rows.reduce((s, [, v]) => s + v.n, 0) || 1;
  const onScale = (px) => SCALE.has(Number(px));
  const offGrid = rows.filter(([px]) => !onScale(px));
  const rare = rows.filter(([px, v]) => onScale(px) && v.n / total < 0.005);

  console.log(`\n===== ${kind}  (${rows.length} distinct, ${total} uses)`);
  console.log(
    '   on grid: ' +
      rows.filter(([px]) => onScale(px)).map(([px, v]) => `${px}px x${v.n}`).join('  '),
  );
  if (offGrid.length) {
    console.log(`   OFF SCALE (${offGrid.length}) — no Tailwind spacing utility produces these:`);
    for (const [px, v] of offGrid) {
      console.log(`      ${px}px  used ${v.n}x   ${v.where.slice(0, 2).join(' , ')}`);
    }
  } else {
    console.log('   OFF SCALE: none');
  }
  if (rare.length) {
    console.log(`   rare but on scale (${rare.length}):`);
    for (const [px, v] of rare) {
      console.log(`      ${px}px  used ${v.n}x   ${v.where.slice(0, 2).join(' , ')}`);
    }
  }
};

report('padding');
report('gap');
report('margin');

await ctx.close();
await browser.close();
await p.cleanup();

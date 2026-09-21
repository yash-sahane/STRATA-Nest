// Does everything that separates things still separate them in the other theme?
//
// Contrast checks in this suite all measure TEXT against its background. A theme can be
// perfectly legible by that measure and still fall apart, because the things that give a
// page its structure are not text:
//
//   a border whose colour has drifted to within a hair of the surface it sits on is a
//   divider that divides nothing — cards run together into one grey field.
//   a card whose background equals the page behind it has no edge at all.
//   a shadow is the whole separation strategy on a light theme and does almost nothing
//   on a dark one, so a surface that relied on it loses its lift.
//
// What makes this a THEME problem rather than a contrast problem is asymmetry: the same
// component, measured in both themes, where one reads and the other does not. That is
// the shape nobody notices, because the theme they work in is fine.
//
// 1.2:1 is not a WCAG number — no criterion covers a decorative divider. It is the point
// below which two greys stop being distinguishable on an ordinary screen, and it is used
// here to rank, not to judge.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const browser = await chromium.launch();
const p = await provision('parity');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

for (let i = 0; i < 3; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `TP-${i}`,
    title: `Theme parity task ${i}`, status: ['TODO', 'IN_PROGRESS', 'DONE'][i],
    priority: 'HIGH', assigneeIds: [mgrId],
  });
}
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'TP-E', name: 'Theme parity epic',
});

// Collect every boundary the page draws, keyed so the same element can be compared
// across themes.
const COLLECT = `(() => {
  const painted = (v) =>
    v && v !== 'transparent' && !/^rgba?\\(0,\\s*0,\\s*0,\\s*0\\)$/.test(v) && !/\\/\\s*0(\\.0+)?\\s*\\)/.test(v);
  const ground = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (painted(bg)) return bg;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
  };
  const key = (el) => {
    const path = [];
    for (let n = el; n && path.length < 4; n = n.parentElement) {
      path.push(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
    }
    return path.reverse().join('>');
  };

  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;

    // Any side, not just the top. A bottom-only border is how nearly every divider in
    // this app is drawn - headers, table rows, card headers - and reading borderTopWidth
    // alone skipped all of them, which is most of the dividers there are.
    // (No backticks in here: this whole audit is a template literal.)
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const side = sides.find(
      (s) => (parseFloat(cs['border' + s + 'Width']) || 0) > 0 && painted(cs['border' + s + 'Color']),
    );
    const hasBorder = Boolean(side);
    const hasOwnBg = painted(cs.backgroundColor);
    if (!hasBorder && !hasOwnBg) continue;

    const behind = ground(el);
    out.push({
      key: key(el),
      cls: String(el.className || '').split(' ').slice(0, 3).join('.'),
      border: hasBorder ? cs['border' + side + 'Color'] : null,
      surface: hasOwnBg ? cs.backgroundColor : behind,
      behind,
      shadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 40) : null,
    });
  }
  // One sample per distinct key is plenty; a hundred identical rows say the same thing.
  const seen = new Set();
  return out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true))).slice(0, 220);
})()`;

const ROUTES = ['/dashboard', '/projects', '/tasks', '/epics', '/team', '/settings', '/analytics'];
const byTheme = { light: new Map(), dark: new Map() };

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await page.setViewportSize({ width: 1280, height: 900 });

for (const route of ROUTES) {
  for (const theme of ['light', 'dark']) {
    await visit(page, route, 5000);
    await page.evaluate((th) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.setAttribute('data-theme', th);
    }, theme);
    // These surfaces carry `transition-colors`; read too early and the value is a frame
    // from the middle of the fade.
    await page.waitForTimeout(1000);
    const rows = await page.evaluate(COLLECT).catch(() => []);
    for (const row of rows) byTheme[theme].set(`${route}|${row.key}`, row);
  }
  console.log(`   collected ${route}`);
}

const ratio = (a, b) => {
  const x = parseColor(a);
  const y = parseColor(b);
  return x && y ? contrast(x.rgb, y.rgb) : null;
};

const asymmetric = [];
const weakBoth = [];
for (const [id, light] of byTheme.light) {
  const dark = byTheme.dark.get(id);
  if (!dark) continue;

  // The edge of the thing: its border against itself, or its surface against the page.
  const edge = (row) =>
    row.border ? ratio(row.border, row.surface) : ratio(row.surface, row.behind);
  const l = edge(light);
  const d = edge(dark);
  if (l === null || d === null) continue;

  const lWeak = l < 1.2;
  const dWeak = d < 1.2;
  if (lWeak !== dWeak) {
    asymmetric.push({ id, l, d, cls: light.cls, kind: light.border ? 'border' : 'surface' });
  } else if (lWeak && dWeak) {
    weakBoth.push({ id, l, d, cls: light.cls, kind: light.border ? 'border' : 'surface' });
  }
}

const show = (title, list, note) => {
  console.log(`\n===== ${title}  (${list.length})`);
  if (!list.length) {
    console.log('   none');
    return;
  }
  console.log(`   ${note}`);
  for (const f of list.slice(0, 14)) {
    console.log(
      `   light ${f.l.toFixed(2)}  dark ${f.d.toFixed(2)}  ${f.kind.padEnd(7)} ${f.id.split('|')[0]}  ${f.cls}`,
    );
  }
};

show('boundaries that read in ONE theme and not the other', asymmetric,
  'the same component, measured in both — this is the asymmetry nobody notices');
show('boundaries that are faint in BOTH themes', weakBoth,
  'a deliberate hairline, or a divider that never divided anything');

console.log(
  `\n   compared ${byTheme.light.size} light against ${byTheme.dark.size} dark boundaries`,
);

await ctx.close();
await browser.close();
await p.cleanup();

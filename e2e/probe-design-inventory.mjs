// What does this app ACTUALLY render, as opposed to what the source says it should?
//
// Consistency cannot be read off the source: a component is consistent or not at the
// pixel, after Tailwind's cascade, tailwind-merge's overrides, and whatever className a
// call site passed in. Two buttons that look identical in JSX routinely measure
// differently because one site added `h-9` and another did not.
//
// So this counts what the browser paints, across every route, in both themes:
//
//   type          families, sizes, weights — a scale with 19 sizes in it is not a scale
//   motion        transition durations and easings — the vocabulary of the animation
//   shape         border radii, border widths
//   controls      the heights of buttons and inputs, which should come in a few sizes
//   spacing       paddings on cards and buttons
//
// Inventory, not judgement. The output is a frequency table; a value used once among
// hundreds is the interesting thing, and whether it is WRONG needs a human eye on the
// specific case. Printing the routes each rare value came from makes that possible.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const browser = await chromium.launch();
const p = await provision('inventory');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Enough content that the real components render rather than empty states.
for (let i = 0; i < 4; i += 1) {
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `INV-${i}`,
    title: `Inventory task ${i}`, status: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'][i % 4],
    priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4], assigneeIds: [mgrId],
  });
}
await api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'INV-E', name: 'Inventory epic',
});
await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Inventory sprint',
  startDate: '2026-10-01', endDate: '2026-10-14',
});

const COLLECT = `(() => {
  const bump = (m, k, tag) => {
    if (!k) return;
    if (!m[k]) m[k] = { n: 0, where: [] };
    m[k].n += 1;
    if (tag && m[k].where.length < 3 && !m[k].where.includes(tag)) m[k].where.push(tag);
  };
  const out = {
    fontFamily: {}, fontSize: {}, fontWeight: {}, lineHeight: {},
    duration: {}, easing: {}, radius: {}, borderWidth: {},
    buttonHeight: {}, inputHeight: {}, cardPadding: {}, buttonPadding: {},
  };
  const tag = (el) => {
    const c = String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    // Type, but only where there is actual text to set — otherwise every wrapper div
    // inflates the counts with inherited values nobody chose.
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      bump(out.fontFamily, cs.fontFamily.split(',')[0].replace(/["']/g, ''), tag(el));
      bump(out.fontSize, cs.fontSize, tag(el));
      bump(out.fontWeight, cs.fontWeight, tag(el));
      bump(out.lineHeight, cs.lineHeight, tag(el));
    }

    if (cs.transitionDuration && cs.transitionDuration !== '0s') {
      for (const d of cs.transitionDuration.split(',')) bump(out.duration, d.trim(), tag(el));
      for (const e of cs.transitionTimingFunction.split(',')) bump(out.easing, e.trim(), tag(el));
    }
    if (cs.borderRadius && cs.borderRadius !== '0px') bump(out.radius, cs.borderRadius, tag(el));
    if (cs.borderTopWidth && cs.borderTopWidth !== '0px') bump(out.borderWidth, cs.borderTopWidth, tag(el));

    const t = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (t === 'button' || role === 'button') {
      bump(out.buttonHeight, Math.round(r.height) + 'px', tag(el));
      bump(out.buttonPadding, cs.paddingTop + ' ' + cs.paddingRight, tag(el));
    }
    if (t === 'input' || t === 'select' || t === 'textarea') {
      bump(out.inputHeight, Math.round(r.height) + 'px', tag(el));
    }
    if (/\\brounded-lg\\b/.test(String(el.className)) && /\\bborder\\b/.test(String(el.className))) {
      bump(out.cardPadding, cs.padding, tag(el));
    }
  }
  return out;
})()`;

const ROUTES = [
  '/dashboard', '/projects', '/tasks', '/epics', '/requirements', '/functional-requirements',
  '/sprints', '/team', '/attendance', '/time-tracking', '/leave', '/calendar',
  '/activity', '/analytics', '/workspaces', '/settings', '/profile', '/notifications',
];

const totals = {};
const merge = (into, from, route) => {
  for (const key of Object.keys(from)) {
    into[key] ??= {};
    for (const val of Object.keys(from[key])) {
      into[key][val] ??= { n: 0, where: [] };
      into[key][val].n += from[key][val].n;
      for (const w of from[key][val].where) {
        const tagged = `${route} ${w}`;
        if (into[key][val].where.length < 4) into[key][val].where.push(tagged);
      }
    }
  }
};

for (const theme of ['light', 'dark']) {
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const route of ROUTES) {
    await visit(page, route, 4500);
    await page.evaluate((th) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.setAttribute('data-theme', th);
    }, theme);
    await page.waitForTimeout(700);
    const got = await page.evaluate(COLLECT).catch(() => null);
    if (got) merge(totals, got, route);
  }
  await ctx.close();
  if (theme === 'light') console.log('   light pass done');
}

const report = (key, title, { rareBelow = 0.02 } = {}) => {
  const entries = Object.entries(totals[key] ?? {}).sort((a, b) => b[1].n - a[1].n);
  const total = entries.reduce((s, [, v]) => s + v.n, 0) || 1;
  console.log(`\n===== ${title}  (${entries.length} distinct, ${total} uses)`);
  for (const [val, v] of entries) {
    const share = v.n / total;
    const rare = share < rareBelow;
    console.log(
      `   ${String(val).padEnd(34)} ${String(v.n).padStart(5)}  ${(share * 100).toFixed(1).padStart(5)}%` +
        (rare ? `   <- rare: ${v.where.slice(0, 2).join(' , ')}` : ''),
    );
  }
};

report('fontFamily', 'font families');
report('fontSize', 'font sizes');
report('fontWeight', 'font weights');
report('duration', 'transition durations');
report('easing', 'transition easings');
report('radius', 'border radii');
report('borderWidth', 'border widths');
report('buttonHeight', 'button heights');
report('inputHeight', 'input heights');
report('buttonPadding', 'button padding (top right)');

await browser.close();
await p.cleanup();

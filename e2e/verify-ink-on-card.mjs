// Coloured ink on a plain card: which raw-palette text colours are unreadable?
//
// The whole-app sweep found `text-yellow-600` at 2.94:1 against a 3:1 floor -- on
// `getHealthColor`, which paints a project's score. It caught that one because a project
// happened to score in the 40-69 band while the sweep was on the page; the other three
// branches of that same function, and every other raw-palette text colour in the app,
// were not on screen. This is the same shape as the toast finding: one instance visible,
// a family behind it.
//
// It is also a colour the sweep could not see until `lab()` was parsed, so nothing here
// was ever measured before.
//
// A tinted CHIP (`bg-yellow-100 text-yellow-800`) pairs its ink with its own fill and
// measures 6.49:1 to 16.26:1. The risky pattern is coloured ink on the PLAIN card, where
// the ink was picked for hue and the background is whatever the card is. That is what
// this measures, for every raw text class the source actually uses, in the theme where
// each applies.
import { chromium, provision, addRole, signedInPage, visit } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 320)}`); };

// Two groups, because they answer to different rules.
//
// TEXT shades colour a number or a label and must clear 4.5:1 (3:1 if large). ICON shades
// tint a glyph: WCAG sets no minimum for a decorative graphic, and every one of these sits
// beside text that carries the same meaning, so they are measured and reported rather than
// asserted. Keeping them in one list made an assertion that could never pass, and an
// assertion that can never pass gets ignored.
const ICON_ONLY = new Set([
  'text-yellow-500', 'text-green-500', 'text-emerald-500', 'text-sky-500',
  'text-orange-500', 'text-purple-500', 'text-violet-500', 'text-blue-500',
  'text-red-500', 'text-gray-500',
]);

const LIGHT_INK = [
  // getHealthColor, after the fix: -700 in light
  'text-red-700', 'text-yellow-700', 'text-green-700', 'text-emerald-700',
  // yellow-600 / green-600 / orange-600 / emerald-600 are deliberately absent: they are no
  // longer used anywhere (2.94:1, 3.22:1, 3.60:1 and 3.65:1 on the white card), so Tailwind
  // compiles no rule for them and listing them here would trip the inert guard rather than
  // measure anything. red-600 (4.77:1) and blue-600 (5.25:1) are still live and still pass.
  'text-red-600',
  // other numbers-on-a-card sites. `text-orange-600` is gone from this list for the same
  // reason as the other three: no site uses it now, so there is no rule to measure.
  'text-blue-600', 'text-blue-700', 'text-red-700',
  'text-green-700', 'text-yellow-700', 'text-orange-700', 'text-gray-600',
  // the unpaired mid shades, which apply in light theme too
  'text-red-500', 'text-green-500', 'text-emerald-500', 'text-orange-500',
  'text-yellow-500', 'text-purple-500', 'text-blue-500', 'text-sky-500',
  'text-gray-500', 'text-violet-500',
  // `text-sky-700` and `text-violet-700` were dropped from this list: neither appears in
  // the source, so Tailwind compiles no rule for them and the probe's own guard correctly
  // reported them as inert (they measured 19.80:1 by inheriting the plain foreground).
  'text-purple-700',
];
// `dark:`-PREFIXED, because that is the class the source writes and therefore the only
// one Tailwind compiled. Applying the bare `text-green-400` matched no rule at all, so
// every one of these silently measured the inherited foreground instead.
const DARK_INK = [
  'dark:text-red-400', 'dark:text-yellow-400', 'dark:text-green-400',
  'dark:text-emerald-400', 'dark:text-orange-400', 'dark:text-blue-400',
  'dark:text-purple-400', 'dark:text-gray-400', 'dark:text-green-300',
  'dark:text-blue-300',
  // the unpaired mid shades ARE written bare, so on a dark card they apply as-is
  'text-red-500', 'text-green-500', 'text-emerald-500', 'text-orange-500',
  'text-yellow-500', 'text-purple-500', 'text-blue-500', 'text-sky-500',
  'text-gray-500', 'text-violet-500',
];

const browser = await chromium.launch();
const p = await provision('inkcard');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 7000);

const measure = (theme, classes) => page.evaluate(({ th, cls }) => {
  document.documentElement.classList.toggle('dark', th === 'dark');
  document.documentElement.setAttribute('data-theme', th);

  // The real surfaces a number sits on.
  const surfaces = ['bg-card', 'bg-background', 'bg-muted'];
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  document.body.appendChild(host);

  const grounds = {};
  for (const s of surfaces) {
    const d = document.createElement('div');
    d.className = s;
    host.appendChild(d);
    grounds[s] = getComputedStyle(d).backgroundColor;
  }

  const inks = {};
  for (const c of cls) {
    const span = document.createElement('span');
    span.className = c;
    span.textContent = 'Xg';
    host.appendChild(span);
    inks[c] = getComputedStyle(span).color;
  }

  // What an element with NO colour class resolves to, so a class that failed to apply
  // can be told apart from one that applied and happens to be light.
  const plain = document.createElement('span');
  plain.textContent = 'Xg';
  host.appendChild(plain);
  const plainForeground = getComputedStyle(plain).color;

  host.remove();
  return { grounds, inks, plainForeground };
}, { th: theme, cls: classes });

const ratio = (fg, bg) => {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b || b.alpha === 0) return null;
  return contrast(f.rgb, b.rgb);
};

const failures = [];
const iconRows = [];
for (const [theme, classes] of [['light', LIGHT_INK], ['dark', DARK_INK]]) {
  console.log(`\n===== ${theme}: coloured ink on the card surface`);
  const { grounds, inks, plainForeground } = await measure(theme, classes);
  const card = grounds['bg-card'];
  console.log(`   card = ${card}   plain foreground = ${plainForeground}`);

  // A class that matched no rule inherits the plain foreground, which measures ~19:1 and
  // reads as a comfortable pass. That is how the whole dark column of an earlier run
  // scored perfectly while testing nothing. Report it instead.
  const inert = classes.filter((c) => inks[c] === plainForeground);
  rec(inert.length === 0,
    `${theme}: every class under test actually applies (none silently inherit)`,
    inert.length ? `${inert.join(', ')} all resolved to the plain foreground ${plainForeground}` : '');

  const rows = [];
  for (const c of classes) {
    const r = ratio(inks[c], card);
    if (r === null) {
      rec(false, `${theme}: ${c} could be measured`, `ink=${inks[c]} card=${card}`);
      continue;
    }
    rows.push({ c, ink: inks[c], r });
  }
  rows.sort((a, b) => a.r - b.r);
  for (const row of rows) {
    // 4.5 is the floor for normal text, 3 for large (>=24px bold / >=18.66px bold).
    const normal = row.r >= 4.5;
    const large = row.r >= 3;
    const iconOnly = ICON_ONLY.has(row.c);
    const mark = iconOnly ? 'icon   ' : normal ? 'ok     ' : large ? 'LARGE  ' : 'FAILS  ';
    console.log(`   ${mark} ${row.c.padEnd(20)} ${row.ink.padEnd(22)} ${row.r.toFixed(2)}:1`);
    if (iconOnly) iconRows.push({ theme, ...row });
    else if (!normal) failures.push({ theme, ...row, large });
  }
}

console.log('\n===== verdict');
// Text ink must clear the NORMAL-text floor. The helpers here are exported and reused, so
// holding them to 4.5:1 rather than to whichever floor their current call site happens to
// face is the point -- getHealthColor passed 3:1 at its one call site while sitting at
// 2.94:1, and a second call site at normal size would have inherited a failure.
const realFailures = failures.filter((f) => !f.large || f.r < 3);
rec(realFailures.length === 0,
  'every raw-palette TEXT ink clears the 4.5:1 floor, or at minimum 3:1 for large text',
  failures.map((f) => `${f.theme} ${f.c} ${f.r.toFixed(2)}:1`).join(' | '));

// Reported, deliberately not asserted. These tint glyphs that sit beside text carrying the
// same meaning, so WCAG sets them no floor; the numbers are here so leaving them stays a
// decision with evidence behind it.
const weakIcons = iconRows.filter((r) => r.r < 3);
console.log(`   icon-only mid shades under 3:1 (no text floor applies): ${weakIcons.length}`);
for (const w of weakIcons) {
  console.log(`      ${w.theme} ${w.c.padEnd(20)} ${w.r.toFixed(2)}:1`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

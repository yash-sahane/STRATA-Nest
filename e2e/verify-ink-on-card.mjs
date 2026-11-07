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
  'text-sky-500', 'text-purple-500', 'text-violet-500', 'text-blue-500',
  'text-red-500', 'text-gray-500',
  // The four that were lifted: written `text-<hue>-700 dark:text-<hue>-500`, so the
  // mid shade now exists only under the dark variant.
  'dark:text-yellow-500', 'dark:text-green-500', 'dark:text-emerald-500',
  'dark:text-orange-500',
]);

const browser = await chromium.launch();
const p = await provision('inkcard');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 7000);

// The lists are READ FROM THE STYLESHEET the app ships, not kept by hand: every
// `text-<hue>-<n>` rule Tailwind compiled is a class some screen uses. A hand-kept list
// went stale each time a site stopped using a shade — no rule was compiled for it, the
// inert guard below tripped, and the failure said nothing about contrast.
const { bareInk, darkInk } = await page.evaluate(() => {
  const bare = new Set();
  const dark = new Set();
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) visit(rule.cssRules);
      const selector = rule.selectorText;
      if (!selector) continue;
      for (const m of selector.matchAll(/\.(dark\\:)?text-([a-z]+)-([2-9]00)(?![\w-])/g)) {
        if (['primary', 'secondary', 'muted', 'accent', 'destructive', 'foreground'].includes(m[2])) continue;
        (m[1] ? dark : bare).add(`${m[1] ? 'dark:' : ''}text-${m[2]}-${m[3]}`);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* a cross-origin sheet: not the app's */
    }
  }
  return { bareInk: [...bare].sort(), darkInk: [...dark].sort() };
});
// The status inks the screens use instead of a palette pair (globals.css). They carry the
// meaning of most coloured text now, so they are held to the same floor in both themes.
const TOKEN_INK = ['text-success-text', 'text-warning-text', 'text-info-text', 'text-destructive-text'];
// Bare light shades are written for the light card; in dark theme only the mid and deep
// bare shades are measured, as before, beside the `dark:` ones.
const LIGHT_INK = [...bareInk.filter((c) => !/-[2-4]00$/.test(c)), ...TOKEN_INK];
const DARK_INK = [...darkInk, ...bareInk.filter((c) => /-500$/.test(c)), ...TOKEN_INK];
console.log(`   compiled: ${bareInk.length} bare and ${darkInk.length} dark palette inks, plus ${TOKEN_INK.length} status tokens`);

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

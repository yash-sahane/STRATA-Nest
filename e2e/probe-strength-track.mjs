// Can you see how full the password strength bar is?
//
// The fill sits directly on `bg-muted` with nothing between them. `bg-muted` is a pale
// grey in light theme and a dark grey in dark theme, so a single mid-saturation shade
// cannot serve both: whatever reads on one is close to invisible on the other.
//
// 3:1 is the floor being aimed at (WCAG 1.4.11, non-text contrast). The strength is also
// stated in words underneath, so the bar is not the sole carrier and this is not strictly
// a conformance failure — but a bar you cannot read is a bar that is not doing its job,
// and the words are below it rather than on it.
//
// READ FROM THE THEME, NOT FROM A UTILITY CLASS. The first version of this probe applied
// `bg-amber-600` to a div and measured what came out. Tailwind only generates the
// utilities a codebase actually uses, so every shade the app does not already use
// resolved to a transparent background — which scored 19.26:1 in light and 1.39:1 in
// dark and read as a clear pass. Fourteen candidates were "measured" that way and every
// one of the numbers was the absence of a rule. The palette lives in `--color-<hue>-<n>`
// whether or not a utility exists, so that is what this reads, and a variable that comes
// back empty is reported as unmeasured rather than scored.
import { chromium, provision, addRole, signedInPage, visit } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const HUES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal'];
const SHADES = [400, 500, 600, 700, 800];
// The tokens, for comparison: one of these is preferable to raw palette, because it
// tracks the theme on its own.
const TOKENS = ['destructive', 'warning', 'success', 'info', 'primary'];

const browser = await chromium.launch();
const p = await provision('strength');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 7000);

const measure = (theme) =>
  page.evaluate(
    ({ th, hues, shades, tokens }) => {
      document.documentElement.classList.toggle('dark', th === 'dark');
      document.documentElement.setAttribute('data-theme', th);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(host);

      // Resolve a colour by PAINTING it, so whatever the variable holds — hex, oklch,
      // `hsl(var(--x))` — comes back as the rgb the browser would actually show.
      const paint = (value) => {
        const d = document.createElement('div');
        d.style.backgroundColor = value;
        host.appendChild(d);
        const painted = getComputedStyle(d).backgroundColor;
        // An invalid value leaves backgroundColor at its initial `rgba(0, 0, 0, 0)`.
        return /^rgba\(0, 0, 0, 0\)$/.test(painted) ? null : painted;
      };
      const themeVar = (name) => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return raw ? paint(raw) : null;
      };

      const track = (() => {
        const d = document.createElement('div');
        d.className = 'bg-muted';
        host.appendChild(d);
        return getComputedStyle(d).backgroundColor;
      })();

      const out = { track, fills: {} };
      for (const h of hues) {
        for (const s of shades) out.fills[`${h}-${s}`] = themeVar(`--color-${h}-${s}`);
      }
      for (const t of tokens) out.fills[t] = themeVar(`--color-${t}`);
      host.remove();
      return out;
    },
    { th: theme, hues: HUES, shades: SHADES, tokens: TOKENS },
  );

const results = {};
let unmeasured = 0;
for (const theme of ['light', 'dark']) {
  const m = await measure(theme);
  const track = parseColor(m.track);
  console.log(`\n===== ${theme}   track (bg-muted) ${m.track}`);
  if (!track) {
    console.log('   the TRACK itself could not be parsed — nothing below means anything');
    unmeasured += Object.keys(m.fills).length;
    results[theme] = {};
    continue;
  }
  results[theme] = {};
  for (const key of Object.keys(m.fills)) {
    const raw = m.fills[key];
    const c = raw ? parseColor(raw) : null;
    if (!c) {
      results[theme][key] = null;
      unmeasured += 1;
      continue;
    }
    results[theme][key] = contrast(c.rgb, track.rgb);
  }
  const cell = (k) => {
    const r = results[theme][k];
    return r === null ? 'UNMEASURED' : `${r.toFixed(2)}${r >= 3 ? ' ' : '!'}`;
  };
  for (const h of HUES) {
    console.log(`   ${h.padEnd(8)} ${SHADES.map((s) => `${s}: ${cell(`${h}-${s}`)}`).join('  ')}`);
  }
  for (const t of TOKENS) console.log(`   --color-${t.padEnd(14)} ${cell(t)}`);
}

console.log(`\n   ! = under the 3:1 non-text floor.  ${unmeasured} value(s) could not be read.`);

console.log('\n===== clears 3:1 in BOTH themes as one class (no dark: pair needed)');
const both = Object.keys(results.light ?? {}).filter(
  (k) => (results.light[k] ?? 0) >= 3 && (results.dark?.[k] ?? 0) >= 3,
);
console.log(both.length ? '   ' + both.join(', ') : '   none');

console.log('\n===== per hue, which shades pass in each theme');
for (const h of HUES) {
  const pass = (theme) =>
    SHADES.filter((s) => (results[theme]?.[`${h}-${s}`] ?? 0) >= 3).join('/') || 'none';
  console.log(`   ${h.padEnd(8)} light: ${pass('light').padEnd(24)} dark: ${pass('dark')}`);
}

await ctx.close();
await browser.close();
await p.cleanup();

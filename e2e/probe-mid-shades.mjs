// What do the -500 icon shades measure, and what would clear the floor?
//
// 41 uses of `text-<hue>-500` across the app, mostly icons but two of them real text.
// They are used BARE — no `dark:` counterpart — so the same value serves both themes, and
// a shade picked for one is being asked to work on the other.
import { chromium, provision, addRole, signedInPage, visit } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const HUES = ['red', 'orange', 'yellow', 'green', 'emerald', 'blue', 'purple'];
const SHADES = [500, 600, 700];

const browser = await chromium.launch();
const p = await provision('midshade');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 7000);

const measure = (theme) => page.evaluate(({ th, hues, shades }) => {
  document.documentElement.classList.toggle('dark', th === 'dark');
  document.documentElement.setAttribute('data-theme', th);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(host);
  const read = (cls) => {
    const d = document.createElement('div');
    d.className = cls;
    host.appendChild(d);
    return getComputedStyle(d).color;
  };
  const bg = (cls) => {
    const d = document.createElement('div');
    d.className = cls;
    host.appendChild(d);
    return getComputedStyle(d).backgroundColor;
  };
  const out = { card: bg('bg-card'), fills: {} };
  for (const h of hues) for (const s of shades) out.fills[`${h}-${s}`] = read(`text-${h}-${s}`);
  host.remove();
  return out;
}, { th: theme, hues: HUES, shades: SHADES });

for (const theme of ['light', 'dark']) {
  const m = await measure(theme);
  const card = parseColor(m.card)?.rgb ?? [255, 255, 255];
  console.log(`\n===== ${theme}   card ${m.card}`);
  for (const h of HUES) {
    const row = SHADES.map((s) => {
      const c = parseColor(m.fills[`${h}-${s}`]);
      if (!c) return `${s}: ?`;
      const r = contrast(c.rgb, card);
      return `${s}: ${r.toFixed(2)}${r >= 3 ? '' : '!'}`;
    });
    console.log(`   ${h.padEnd(9)} ${row.join('   ')}`);
  }
}
console.log('\n   ! = under the 3:1 non-text floor');

await ctx.close();
await browser.close();
await p.cleanup();

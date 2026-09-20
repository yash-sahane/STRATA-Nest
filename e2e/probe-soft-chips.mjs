// What do the attendance tints actually measure?
//
// The legend chips and the calendar day cells use raw palette pairs — `bg-green-100
// dark:bg-green-900` with `text-green-800 dark:text-green-200` — rather than the tone
// system, whose header says soft tints are deliberately not exposed there. Before adding
// a soft layer to that system it is worth knowing whether these READ badly or merely
// bypass the vocabulary, because those are different problems with different fixes.
//
// THREE WAYS THIS PROBE HAS LIED, all now closed:
//
//   1. It applied classes typed out here to a scratch div. A bare `bg-green-900` is never
//      compiled, because the source only ever writes `dark:bg-green-900`; every dark chip
//      came back transparent, and transparent on transparent scored an identical 20.12:1
//      for all seven — the absence of a rule, reported as a comfortable pass.
//   2. It selected `[data-slot="badge"]`. Badge renders a plain <div> with no such
//      attribute, so it matched nothing at all.
//   3. It decided "does this have a background" with an `rgba()` regex. Tailwind v4
//      paints `lab()`, so every real chip failed the test and was skipped.
//
// Each one produced "0 failures" while measuring nothing. That is why the count of things
// which could NOT be read is printed next to the failures rather than left implicit.
import { chromium, provision, addRole, signedInPage, visit } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const browser = await chromium.launch();
const p = await provision('softchip');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/attendance', 9000);

// Radix unmounts an inactive TabsContent, so the legend does not exist until the Calendar
// tab is selected.
await page.getByRole('tab', { name: /calendar/i }).click();
await page.waitForTimeout(3000);

/**
 * Switch theme, then WAIT.
 *
 * These chips carry `transition-colors`. Reading them in the same evaluate as the class
 * toggle catches the interpolation mid-flight: the light pass reported a dark-green
 * background with light-green ink — the dark pair, apparently applied with no `.dark` on
 * the page — and the numbers came out identical to two decimal places in both themes,
 * which is what a half-finished transition looks like if you mistake it for a
 * measurement. The tell was the colour SYNTAX: settled values arrive as `lab()`,
 * interpolated ones as `oklab()`.
 */
const setTheme = async (theme) => {
  await page.evaluate((th) => {
    document.documentElement.classList.toggle('dark', th === 'dark');
    document.documentElement.setAttribute('data-theme', th);
  }, theme);
  await page.waitForTimeout(1200);
};

const collect = () =>
  page.evaluate(() => {
    // Format-agnostic: anything that is not one of the ways CSS spells "nothing" is a
    // painted background, whatever colour syntax the framework emitted. `/ <alpha>`
    // inside the parens is how lab()/oklab() carry transparency.
    const painted = (value) =>
      Boolean(value) &&
      value !== 'transparent' &&
      !/^rgba?\(0,\s*0,\s*0,\s*0\)$/.test(value) &&
      !/\/\s*0(\.0+)?\s*\)/.test(value);

    /** The colour actually behind an element, walking up through transparency. */
    const ground = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (painted(bg)) return bg;
      }
      return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
    };

    const out = [];
    for (const el of document.querySelectorAll('div, span')) {
      const s = getComputedStyle(el);
      if (!painted(s.backgroundColor)) continue;
      const label = (el.textContent || '').trim();
      if (!label || label.length > 24) continue;
      // A chip, not a container holding one: no descendant carries its own background.
      const nested = [...el.querySelectorAll('div, span')].some((c) =>
        painted(getComputedStyle(c).backgroundColor),
      );
      if (nested) continue;
      out.push({ label, fg: s.color, bg: s.backgroundColor, behind: ground(el) });
    }
    return out;
  });

// The seven states the legend names.
const WANTED = ['Present', 'Late', 'Absent', 'Half Day', 'On Leave', 'Weekend', 'Holiday'];
/** Strip the emoji/tick a chip leads with, and any day number a cell prefixes. */
const normalise = (s) => s.replace(/[\d]+/g, ' ').replace(/[^\w ]+/g, ' ').replace(/\s+/g, ' ').trim();

let failures = 0;
let missing = 0;
for (const theme of ['light', 'dark']) {
  await setTheme(theme);
  const chips = await collect();
  console.log(`\n===== ${theme}`);
  for (const want of WANTED) {
    const chip = chips.find((c) => normalise(c.label).startsWith(want));
    if (!chip) {
      missing += 1;
      console.log(`   ${want.padEnd(10)} NOT ON THE PAGE — nothing measured`);
      continue;
    }
    const f = parseColor(chip.fg);
    const b = parseColor(chip.bg);
    const behind = parseColor(chip.behind);
    if (!f || !b || !behind) {
      missing += 1;
      console.log(`   ${want.padEnd(10)} UNREADABLE  fg=${chip.fg} bg=${chip.bg}`);
      continue;
    }
    const ink = contrast(f.rgb, b.rgb);
    const tint = contrast(b.rgb, behind.rgb);
    const bad = ink < 4.5;
    if (bad) failures += 1;
    console.log(
      `   ${want.padEnd(10)} ink on tint ${ink.toFixed(2)}${bad ? '  <- under 4.5' : '  '}` +
        `   tint on what is behind it ${tint.toFixed(2)}`,
    );
  }
}
console.log(
  `\n   ${failures} under the 4.5:1 text floor; ` +
    `${missing} that could not be found or read (NOT a pass)`,
);

await ctx.close();
await browser.close();
await p.cleanup();

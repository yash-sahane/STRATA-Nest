// Does the attendance calendar explain every colour it paints?
//
// The legend was a hand-written list of six badges sitting next to a colour map
// (`getAttendanceStatusColor`) that knows seven states. A public holiday paints the day
// cell purple, and purple appeared in no key — so somebody looking at a purple square had
// nothing on the page telling them what it meant. Two copies of one list, and the copies
// disagreed.
//
// Also measures the ink on every chip, because the legend is where those tints are most
// legible for a probe and a drift in either direction would show up here first. The
// values come off the REAL badges after the theme transition settles: an earlier probe
// applied hand-typed classes to a scratch div, and since the source only ever writes
// `dark:bg-green-900`, the bare class was never compiled and all seven chips scored an
// identical 20.12:1 — the absence of a rule, read as a comfortable pass.
import { chromium, provision, addRole, signedInPage, visit, recorder } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const { rec, summary } = recorder();

// Every state a day cell can be painted. UNKNOWN shares Weekend's grey and means "nothing
// to report" — a future date, or one before the person joined — so it needs no key.
const STATES = ['Present', 'Late', 'Absent', 'Half Day', 'On Leave', 'Holiday', 'Weekend'];

const browser = await chromium.launch();
const p = await provision('legend');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/attendance', 9000);

// Radix unmounts an inactive TabsContent, so the legend does not exist until the Calendar
// tab is selected — and a check that never found it would report nothing wrong.
await page.getByRole('tab', { name: /calendar/i }).click();
await page.waitForTimeout(3000);

const setTheme = async (theme) => {
  await page.evaluate((th) => {
    document.documentElement.classList.toggle('dark', th === 'dark');
    document.documentElement.setAttribute('data-theme', th);
  }, theme);
  // These chips carry `transition-colors`; read in the same tick and the value is a frame
  // from the middle of the animation.
  await page.waitForTimeout(1200);
};

const collect = () =>
  page.evaluate(() => {
    // Format-agnostic: Tailwind v4 paints `lab()`, so an `rgba()` test skips every real
    // chip. `/ <alpha>` inside the parens is how lab()/oklab() carry transparency.
    const painted = (value) =>
      Boolean(value) &&
      value !== 'transparent' &&
      !/^rgba?\(0,\s*0,\s*0,\s*0\)$/.test(value) &&
      !/\/\s*0(\.0+)?\s*\)/.test(value);

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
      const nested = [...el.querySelectorAll('div, span')].some((c) =>
        painted(getComputedStyle(c).backgroundColor),
      );
      if (nested) continue;
      out.push({ label, fg: s.color, bg: s.backgroundColor, behind: ground(el) });
    }
    return out;
  });

/** Strip the emoji a chip leads with, and any day number a cell prefixes. */
const normalise = (s) =>
  s.replace(/\d+/g, ' ').replace(/[^\w ]+/g, ' ').replace(/\s+/g, ' ').trim();

for (const theme of ['light', 'dark']) {
  await setTheme(theme);
  const chips = await collect();
  console.log(`\n===== ${theme}`);

  for (const state of STATES) {
    const chip = chips.find((c) => normalise(c.label).startsWith(state));
    if (!chip) {
      rec(
        false,
        `${theme}: the legend explains ${state}`,
        `no chip reads "${state}" — the calendar paints this state, so a cell can appear ` +
          'in a colour with nothing on the page to explain it',
      );
      continue;
    }
    rec(true, `${theme}: the legend explains ${state}`);

    const f = parseColor(chip.fg);
    const b = parseColor(chip.bg);
    if (!f || !b) {
      rec(
        false,
        `${theme}: the ${state} chip can be read`,
        `fg=${chip.fg} bg=${chip.bg} — an unreadable colour is not a pass`,
      );
      continue;
    }
    const ink = contrast(f.rgb, b.rgb);
    rec(
      ink >= 4.5,
      `${theme}: the ${state} chip's text clears AA on its own tint`,
      `${ink.toFixed(2)}:1`,
    );
    console.log(`   ${state.padEnd(10)} ink ${ink.toFixed(2)}:1`);
  }
}

const rows = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

// Can you actually get to everything inside a scrolling strip?
//
// A tab strip that holds more tabs than fit is given `overflow-x: auto` so the trailing
// ones can be scrolled to. That fixes the right-hand end and says nothing about the left.
//
// `justify-content: center` on an overflowing flex container splits the overflow across
// BOTH ends, and `scrollLeft` cannot go below zero — so whatever hangs off the left is
// unreachable however you scroll. Measured on /settings at 768px: the first tab was cut
// by 51px, scrollLeft was already 0, and the 55px of available scroll all went the other
// way. The label read "rofile".
//
// It is the same defect the `overflow-x-auto` was added to fix, reintroduced at the other
// end — which is why this is a check and not a one-line fix. TabsList is shared by every
// tabbed screen in the app, so one class on it is either right everywhere or wrong
// everywhere.
//
// Widths matter more than routes here: a strip is only ever cut at the width where its
// content stops fitting, and that width is different for every strip.
import { chromium, provision, addRole, signedInPage, visit, recorder } from './kit.mjs';

const { rec, summary } = recorder();

const browser = await chromium.launch();
const p = await provision('reachable');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

const ROUTES = ['/settings', '/attendance', '/profile', '/time-tracking', '/leave'];
// Across the range where a strip goes from fitting to not fitting.
const WIDTHS = [360, 480, 640, 768, 1024];

/**
 * Every scrollable strip on the page, and what it is hiding at each end.
 *
 * `cutStart` is the part scrolled off the beginning while the container is already at
 * its start — i.e. content no amount of scrolling will reveal. `cutEnd` is ordinary
 * overflow and perfectly fine: that is what scrolling is for.
 */
const AUDIT = `(() => {
  const out = [];
  for (const strip of document.querySelectorAll('[role="tablist"], [class*="overflow-x-auto"]')) {
    const cs = getComputedStyle(strip);
    if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') continue;
    const sr = strip.getBoundingClientRect();
    if (sr.width < 8) continue;
    const kids = [...strip.children];
    if (!kids.length) continue;
    let cutStart = 0;
    let worst = '';
    for (const kid of kids) {
      const kr = kid.getBoundingClientRect();
      const cut = sr.left - kr.left;
      if (cut > cutStart) {
        cutStart = cut;
        worst = (kid.textContent || '').trim().slice(0, 24);
      }
    }
    out.push({
      role: strip.getAttribute('role') || 'scroller',
      justify: cs.justifyContent,
      scrollLeft: Math.round(strip.scrollLeft),
      cutStart: Math.round(cutStart),
      worst,
      overflows: strip.scrollWidth > strip.clientWidth + 2,
    });
  }
  return out;
})()`;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

let checked = 0;
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  for (const route of ROUTES) {
    await visit(page, route, 5000);
    const strips = await page.evaluate(AUDIT).catch(() => null);
    if (!strips) {
      rec(false, `${route} at ${width}px could be audited`, 'page.evaluate failed');
      continue;
    }
    for (const s of strips) {
      checked += 1;
      // Only content cut off at the START while already scrolled to the start is
      // unreachable. Anything hanging off the end is what the scrollbar is for.
      const unreachable = s.cutStart > 2 && s.scrollLeft <= 1;
      if (unreachable) {
        console.log(
          `   ${route} @${width}px  ${s.role} justify=${s.justify} cut ${s.cutStart}px: "${s.worst}"`,
        );
      }
      rec(
        !unreachable,
        `${route} at ${width}px: nothing is cut off the start of a ${s.role}`,
        `"${s.worst}" is cut by ${s.cutStart}px with scrollLeft already ${s.scrollLeft} — ` +
          `justify-content is ${s.justify}; centring overflowing content puts part of it ` +
          'before the scroll origin, where nothing can reach it',
      );
    }
  }
}
console.log(`\n   ${checked} scrolling strip(s) measured across ${WIDTHS.length} widths`);
rec(checked > 0, 'there were scrolling strips to measure at all', 'none found — nothing was tested');

// ---------------------------------------------------------------- the detector works
//
// Put the old behaviour back on one strip and confirm it is caught. Without this, every
// pass above could equally mean the audit never looked at anything.
console.log('\n===== self-test: restoring justify-content:center must be detected');
await page.setViewportSize({ width: 768, height: 900 });
await visit(page, '/settings', 6000);
const caught = await page.evaluate(`(() => {
  const strip = document.querySelector('[role="tablist"]');
  if (!strip) return { none: true };
  strip.style.justifyContent = 'center';
  const sr = strip.getBoundingClientRect();
  let cut = 0;
  for (const kid of strip.children) {
    cut = Math.max(cut, sr.left - kid.getBoundingClientRect().left);
  }
  return { cut: Math.round(cut), scrollLeft: Math.round(strip.scrollLeft) };
})()`);
rec(
  caught?.none !== true && caught.cut > 2,
  'the old centring is caught when put back',
  `with justify-content:center restored the audit measured ${caught?.cut}px cut — if that ` +
    'is zero, this strip fits at this width and the checks above proved nothing here',
);
console.log(`   restored centring cut ${caught?.cut}px off the start`);

const rows = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

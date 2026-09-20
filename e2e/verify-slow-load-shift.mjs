// Does the page stay still when a secondary query answers late?
//
// verify-layout-shift loads each route and measures CLS, which is the right check and
// misses this one: on a fast local stack every query answers before paint, so nothing
// moves and every route reads 0. The shift only appears when one query lags behind
// another — which is the normal condition for a real user on a poor connection, and which
// happened here only by accident, in one full-suite run where the shared rate limiter made
// /team slow. It read 0.1242 that once and 0 every other time.
//
// So this holds the lag still instead of waiting for it. One query is delayed
// deliberately, on every route whose content depends on a query the page does not wait
// for, and CLS is measured against the same "good" bar.
//
// What it caught on /team: `workloadData` is null until the workspace's task list arrives,
// and the Resource Allocation card was gated on it — so the card was ABSENT and then
// appeared, pushing the Team Directory down. 0.1799 against a bar of 0.1. The card now
// renders in a loading state at the height it will occupy, and fills in where it stands.
//
// The other five routes are swept because the SHAPE is the same, not because anything is
// known to be wrong with them. Grepping for the pattern that broke /team found no other
// instance, which is weak evidence — the bug is about what renders when, and that is not
// reliably visible in the source. Holding the query still and looking is.
//
// The self-test at the end matters as much as the measurement: a detector that reports 0
// because it is not looking is indistinguishable from a page that does not move.
import { chromium, provision, addRole, signedInPage, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const DELAY_MS = 4000;
const GOOD_CLS = 0.1;

const browser = await chromium.launch();
const p = await provision('slowshift');
await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
await addRole(p.ws, 'TESTER', 'role.tester@strata.local');

/**
 * Load a route with one endpoint held back, and report the CLS it accumulates.
 *
 * @param delayPattern the request to slow down, or null to leave everything alone.
 * @param inject       drop a block into the page mid-load, to prove the meter moves.
 */
async function measure(route, delayPattern, inject = false) {
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

  await page.addInitScript(() => {
    window.__cls = 0;
    window.__worst = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        if (!window.__worst || entry.value > window.__worst.value) {
          const source = entry.sources?.[0]?.node;
          window.__worst = {
            value: Number(entry.value.toFixed(4)),
            node: source
              ? `${source.tagName?.toLowerCase()}.${String(source.className || '').slice(0, 40)}`
              : '(no node)',
          };
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  if (delayPattern) {
    await page.route(delayPattern, async (r) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      await r.continue();
    });
  }

  await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(delayPattern ? DELAY_MS + 6000 : 8000);

  if (inject) {
    // Insert a tall block ABOVE existing content, which is what a late-arriving card does.
    await page.evaluate(() => {
      const block = document.createElement('div');
      block.style.cssText = 'height:320px';
      const main = document.querySelector('main') ?? document.body;
      main.insertBefore(block, main.firstChild);
    });
    await page.waitForTimeout(1500);
  }

  const cls = await page.evaluate(() => ({ total: window.__cls ?? 0, worst: window.__worst }));
  await ctx.close();
  return { total: Number(cls.total), worst: cls.worst };
}

// The routes whose content depends on a query the page does NOT wait for, delayed by the
// endpoint that feeds it. /team is the one measured at 0.1799; the rest are here because
// the shape is the same — a page that paints, then grows when a second query lands — and
// the only way to know whether they share the bug is to hold the query still and look.
//
// `**/tasks**` covers most of them: the task list feeds the workload card, the dashboard
// counters, the analytics charts and the sprint burndowns, and none of those gate the
// first paint.
const ROUTES = [
  ['/team', '**/tasks**', 'the workspace task list'],
  ['/dashboard', '**/tasks**', 'the task list behind the counters'],
  ['/analytics', '**/tasks**', 'the task list behind the charts'],
  ['/projects', '**/tasks**', 'the task list behind the health badges'],
  ['/sprints', '**/tasks**', 'the task list behind the sprint figures'],
  ['/calendar', '**/tasks**', 'the task list behind the month grid'],
];

for (const [route, pattern, what] of ROUTES) {
  console.log(`\n===== ${route}, with ${what} held back`);

  const fast = await measure(route, null);
  console.log(`   answers fast        CLS ${fast.total.toFixed(4)}`);
  rec(
    fast.total <= GOOD_CLS,
    `${route} is still when every query answers promptly`,
    `CLS ${fast.total.toFixed(4)}${fast.worst ? ` worst on ${fast.worst.node}` : ''}`,
  );

  const slow = await measure(route, pattern);
  console.log(
    `   held ${DELAY_MS}ms          CLS ${slow.total.toFixed(4)}` +
      (slow.worst ? `   worst ${slow.worst.value} on ${slow.worst.node}` : ''),
  );
  rec(
    slow.total <= GOOD_CLS,
    `${route} is still when ${what} answers late`,
    `CLS ${slow.total.toFixed(4)} against a bar of ${GOOD_CLS}` +
      (slow.worst ? `, worst ${slow.worst.value} on ${slow.worst.node}` : '') +
      ' — something arriving late is taking space it did not reserve',
  );
}

// ---------------------------------------------------------------- the meter works
console.log('\n===== self-test: the meter must see a shift it is given');
const injected = await measure('/team', null, true);
console.log(`   after inserting a 320px block   CLS ${injected.total.toFixed(4)}`);
rec(
  injected.total > GOOD_CLS,
  'injecting a shift moves the number, so the readings above are evidence',
  `CLS ${injected.total.toFixed(4)} — a meter that cannot see a 320px block being pushed ` +
    'in front of the page is not measuring anything, and its zeros mean nothing',
);

const rows = summary();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

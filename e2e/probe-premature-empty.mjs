// Does any screen say "there is nothing here" before it knows?
//
// This is the class of bug that keeps turning up in this codebase, and it is the one with
// the worst consequences per line of code:
//
//   /team's Resource Allocation card said "No task assignments yet" to anyone on a slow
//   connection, about a team with hundreds of them.
//   the attendance rate card printed 0% over a window it had not loaded.
//   the tasks board could not tell an id that names no project from a project with no
//   tasks in it.
//
// All the same mistake: a falsy value used for both "nothing" and "not yet". It is
// invisible on a fast local stack, because the data is there before the first paint.
//
// The method: seed REAL rows into every collection, then hold the fetch back and read the
// screen. With data provably present, any empty-state message on screen is a false
// statement — not a judgement call about wording, just a thing that is not true.
import { chromium, api, provision, addRole, signedInPage, whoami } from './kit.mjs';

const browser = await chromium.launch();
const p = await provision('premature');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// ---------------------------------------------------------------- seed one of everything
const mk = async (path, body) => {
  const r = await api(mgr, 'POST', path, body);
  if (r.s >= 400) console.log(`   ! ${path} refused ${r.s}: ${String(r.t).slice(0, 110)}`);
  return r.j;
};

await mk('/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'PE-1',
  title: 'A task that definitely exists', status: 'TODO', priority: 'HIGH',
  assigneeIds: [mgrId],
});
await mk('/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'PE-E1',
  name: 'An epic that definitely exists', status: 'TODO',
});
const cr = await mk('/client_requirements', {
  workspaceId: p.ws, projectId: p.project,
  title: 'A requirement that definitely exists', description: 'seeded',
});
await mk('/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'PE-F1',
  title: 'An FR that definitely exists', clientRequirementId: cr?.id ?? '',
});
await mk('/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'A sprint that definitely exists',
  startDate: '2026-10-01', endDate: '2026-10-14',
});
await mk('/leave_requests', {
  workspaceId: p.ws, userId: mgrId, leaveType: 'CASUAL',
  startDate: '2026-11-02', endDate: '2026-11-03', reason: 'Seeded so the list is not empty',
});
await mk('/time_entries', {
  workspaceId: p.ws, projectId: p.project, description: 'Seeded entry',
  startTime: new Date(Date.now() - 7200e3).toISOString(),
  endTime: new Date(Date.now() - 3600e3).toISOString(),
  isBillable: true,
});

// [route, the endpoint its list comes from]
const CASES = [
  ['/tasks', '**/tasks**'],
  ['/projects', '**/projects**'],
  ['/epics', '**/epics**'],
  ['/requirements', '**/client_requirements**'],
  ['/functional-requirements', '**/functional_requirements**'],
  ['/sprints', '**/sprints**'],
  ['/team', '**/workspace_members**'],
  ['/leave', '**/leave_requests**'],
  ['/time-tracking', '**/time_entries**'],
  ['/activity', '**/activity_logs**'],
  ['/analytics', '**/tasks**'],
  ['/dashboard', '**/tasks**'],
];

// The words the app uses when it believes a collection is empty. Taken from the
// EmptyState call sites rather than invented, so a match is the app's own claim.
const EMPTY_CLAIM =
  /no .{0,28}(yet|found|available)|nothing (to|here)|no (tasks|projects|epics|sprints|requirements|members|entries|activity|leave|results|data)\b/i;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
const DELAY_MS = 5000;

console.log(`\n===== each list held back ${DELAY_MS}ms, with rows provably present`);
for (const [route, pattern] of CASES) {
  await page.unrouteAll?.().catch(() => {});
  await page.route(pattern, async (r) => {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    // A handler left over from the previous route may resolve after unrouteAll, and
    // continuing an already-handled route throws.
    await r.continue().catch(() => {});
  });

  await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded' });
  // Look DURING the wait, which is the whole point — after it, the data has arrived.
  await page.waitForTimeout(2500);
  const mid = await page.evaluate(() => document.body.innerText).catch(() => '');
  const claimed = mid.match(EMPTY_CLAIM);

  // And confirm the page is genuinely still waiting, so a match is not just the state
  // after a fast answer.
  const stillWaiting = await page.evaluate(
    () => !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"]'),
  );

  console.log(
    `   ${route.padEnd(26)} ${claimed ? 'CLAIMS EMPTY: ' + JSON.stringify(claimed[0]) : 'says nothing premature'}` +
      `${stillWaiting ? '' : '   (no loading indicator — may have already answered)'}`,
  );

  await page.waitForTimeout(DELAY_MS);
  const after = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (claimed && !EMPTY_CLAIM.test(after)) {
    console.log(`       -> and once it loaded, that message is GONE: it was not true`);
  }
}

// ------------------------------------------------- can this probe see one at all?
//
// Twelve clean routes is only meaningful if the detector works. A workspace with nothing
// in it MUST trip the same regex — that is the app telling the truth, and it is the one
// case where the message is correct. If this does not fire, every "says nothing
// premature" above is a regex that matches nothing rather than an app that behaves.
console.log('\n===== self-test: an empty workspace must trip the same detector');
const empty = await provision('prematureempty');
await addRole(empty.ws, 'MANAGER', 'role.manager@strata.local');
const { ctx: ctx2, page: page2 } = await signedInPage(
  browser, 'role.manager@strata.local', empty.ws,
);
for (const route of ['/epics', '/requirements', '/sprints']) {
  await page2.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(7000);
  const text = await page2.evaluate(() => document.body.innerText).catch(() => '');
  const m = text.match(EMPTY_CLAIM);
  console.log(`   ${route.padEnd(16)} ${m ? 'detected: ' + JSON.stringify(m[0]) : 'NOT DETECTED'}`);
}
await ctx2.close();
await empty.cleanup();

await ctx.close();
await browser.close();
await p.cleanup();

// Is the app still usable once a workspace has a realistic amount of work in it?
//
// Every check in this suite runs against a workspace holding a handful of rows, which is
// the condition an app is least likely to be broken in. The pages that aggregate — the
// board, the roster, the charts — walk EVERY task in the workspace to produce their
// figures, and two of them do it twice:
//
//   useWorkspaceTasks      listAll, up to 50 pages of 1000
//   useMemberTaskCounts    listAll again, for the workload column
//
// Both feed /team at the same time. At a dozen tasks that is invisible. The question is
// what it is at a few thousand, which is an ordinary year for a real team.
//
// Seeded as SQL rather than through the API on purpose: 2500 creates would take about
// twenty minutes against a 120-per-60s limiter and would starve every other script of
// its budget. The rows are the same rows; only the door is different. Not through Prisma
// either — the client hoisted to the repo root is generated from a different schema than
// packages/prisma/schema and does not know every column.
//
// What this asserts is deliberately modest and behavioural — it is not a benchmark, and a
// number tuned to this laptop would fail on somebody else's. It asserts that the pages
// LOAD, that they show the RIGHT figures rather than a truncated subset, and that nothing
// throws. Timings are printed for a human to read, not asserted on.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder } from './kit.mjs';

const run = promisify(execFile);
const SEED_SQL = fileURLToPath(new URL('./volume-seed.sql', import.meta.url));

const { rec, summary } = recorder();
const TASK_COUNT = 2500;

const browser = await chromium.launch();
const p = await provision('volume');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const mgrId = await whoami(mgr);

/** Run SQL inside the database container, which needs no client library here. */
const psql = async (args) => {
  const { stdout } = await run('docker', [
    'exec', '-i', 'strata-postgres-1',
    'psql', '-U', 'postgres', '-d', 'strata', '-qtA', ...args,
  ]);
  return stdout.trim();
};

const seedStart = Date.now();
await run('docker', ['cp', SEED_SQL, 'strata-postgres-1:/tmp/volume-seed.sql']);
await psql([
  '-v', `ws=${p.ws}`, '-v', `proj=${p.project}`, '-v', `user=${mgrId}`,
  '-v', `count=${TASK_COUNT}`, '-f', '/tmp/volume-seed.sql',
]);
const seeded = Number(
  await psql(['-c', `SELECT count(*) FROM tasks_task WHERE project_id = '${p.project}'`]),
);
console.log(`   seeded ${seeded} tasks in ${((Date.now() - seedStart) / 1000).toFixed(1)}s`);
rec(seeded === TASK_COUNT, `the workspace really holds ${TASK_COUNT} tasks`, `counted ${seeded}`);

// ---------------------------------------------------------------- the API pages properly
{
  // `pageSize`, not `limit`: the frontend's query builder calls it limit, but the wire
  // parameter is pageSize, and asking with the wrong name silently returns the default
  // 100 — which is exactly what a truncation bug looks like from the outside.
  const first = await api(mgr, 'GET', `/tasks?projectId=${p.project}&pageSize=1000&page=1`);
  rec(
    first.j?.total === TASK_COUNT,
    'the API reports the true total, not the page size',
    `total=${first.j?.total}, items on page 1 = ${first.j?.items?.length}`,
  );
  rec(
    (first.j?.items?.length ?? 0) === 1000,
    'a page is capped at MAX_PAGE_SIZE rather than returning everything',
    `page 1 held ${first.j?.items?.length} rows — an uncapped page is how one slow query ` +
      'becomes a timeout for everybody',
  );
  const third = await api(mgr, 'GET', `/tasks?projectId=${p.project}&pageSize=1000&page=3`);
  rec(
    (third.j?.items?.length ?? 0) === TASK_COUNT - 2000,
    'the last page holds the remainder',
    `page 3 held ${third.j?.items?.length}, expected ${TASK_COUNT - 2000}`,
  );
}

// ---------------------------------------------------------------- the pages that aggregate
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) {
    errors.push(m.text().slice(0, 160));
  }
});

/** Load a route, time it, and report whether it finished rather than stalled. */
async function load(route, settleMs = 45000) {
  const started = Date.now();
  await visit(page, route, 4000);
  // Wait for the page to stop showing a loading state, rather than a fixed sleep.
  let settled = false;
  for (let i = 0; i < settleMs / 500 && !settled; i += 1) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    settled =
      text.length > 0 &&
      !/Loading team members|Loading\.\.\./i.test(text) &&
      // An error state is not a settled page. Without this a route that gave up would
      // count as having finished loading — which is true, and useless.
      !/could not load|couldn.t load|something went wrong|try again/i.test(text);
    if (!settled) await page.waitForTimeout(500);
  }
  const ms = Date.now() - started;
  console.log(`   ${route.padEnd(14)} ${settled ? 'settled' : 'STILL LOADING'} in ${(ms / 1000).toFixed(1)}s`);
  return { settled, ms, text: await page.evaluate(() => document.body.innerText).catch(() => '') };
}

console.log(`\n===== the aggregating pages, with ${TASK_COUNT} tasks`);
for (const route of ['/dashboard', '/tasks', '/team', '/analytics']) {
  const r = await load(route);
  rec(
    r.settled,
    `${route} finishes loading with ${TASK_COUNT} tasks`,
    `still showing a loading state after ${(r.ms / 1000).toFixed(1)}s — a page that never ` +
      'settles is indistinguishable from a broken one',
  );
}

// The figures that prove nothing was truncated. Asserted POSITIVELY — that the true
// numbers are on screen — rather than by the absence of a suspicious one: "no 1000
// anywhere" passes just as happily on a page that rendered no figure at all.
//
// The seed puts an even fifth of the tasks in each of the five statuses, so DONE is
// exactly TASK_COUNT / 5. A page counting only its first response would show 100 or 1000.
const DONE_COUNT = TASK_COUNT / 5;
for (const route of ['/dashboard', '/analytics']) {
  const r = await load(route);
  const numbers = r.text.match(/\b\d{2,6}\b/g) ?? [];
  console.log(`   ${route.padEnd(14)} figures on screen: ${JSON.stringify(numbers.slice(0, 8))}`);
  rec(
    numbers.includes(String(TASK_COUNT)),
    `${route} shows the true task total of ${TASK_COUNT}`,
    `the figures on the page are ${JSON.stringify(numbers.slice(0, 10))} — a total of 100 ` +
      'or 1000 would be the page size wearing a total',
  );
  rec(
    numbers.includes(String(DONE_COUNT)),
    `${route} shows the true completed count of ${DONE_COUNT}`,
    `no figure reads ${DONE_COUNT}; the page shows ${JSON.stringify(numbers.slice(0, 10))} — ` +
      'a count derived from one page of results rather than all of them',
  );
}

rec(
  errors.length === 0,
  'nothing threw while loading any of them',
  `${errors.length} error(s): ${errors.slice(0, 3).join(' | ')}`,
);

const rowsOut = summary();
await ctx.close();
await browser.close();
// One statement, rather than asking the API's cascade to walk 2500 rows.
await psql(['-c', `DELETE FROM tasks_task WHERE project_id = '${p.project}'`]);
await p.cleanup();
process.exitCode = rowsOut.some((r) => !r.ok) ? 1 : 0;

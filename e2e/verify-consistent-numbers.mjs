// Figures that contradicted each other, or themselves.
//
//  #31 completing a sprint rewrote its analytics to 100%
//  #32 the Board and Analytics tabs disagreed about the sprint's size
//  #94 two workload panels on /team used different bands for the same count
//  #97 a search result claimed "Match: 270%"
//  #40 "Recent Updates" was neither recent nor across all entities
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('numbers');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const devId = await whoami(await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local'));

/**
 * A create that survives the shared rate limiter.
 *
 * The default throttle is 120/min per IP and the regression suite runs twelve
 * scripts back to back against it, so a create here can come back 429 for
 * reasons that have nothing to do with what is under test. This script once
 * threw on that inside the suite and reported "0/0" — a crash that reads like a
 * script which did not run.
 */
const mustCreate = async (jar, path, body, what) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await api(jar, 'POST', path, body);
    if (r.s === 429) {
      console.log(`   ${what}: rate limited — waiting out the window`);
      await new Promise((res) => setTimeout(res, 62_000));
      continue;
    }
    if (!r.j?.id) throw new Error(`${what} not created: ${r.s} ${r.t.slice(0, 240)}`);
    return r.j;
  }
  throw new Error(`${what} still rate limited after two full windows`);
};

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ---- #31 a sprint that finished 2 of 5 ------------------------------------
console.log('===== a sprint completed with work left over');
const sprint = await mustCreate(mgr, '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Numbers Sprint',
  goal: 'finish some of it', startDate: today, endDate: plus(14), status: 'ACTIVE',
}, 'the sprint');
rec(Boolean(sprint?.id), 'the sprint was created', JSON.stringify(sprint).slice(0, 200));

const taskIds = [];
for (let i = 1; i <= 5; i += 1) {
  const t = await mustCreate(mgr, '/tasks', {
    workspaceId: p.ws, projectId: p.project, sprintId: sprint.id,
    hierarchyId: `NUM-${i}`,
    title: `Numbers task ${i}`, status: 'TODO', priority: 'MEDIUM',
  }, `task ${i}`);
  taskIds.push(t.id);
}
// The server enforces the board's own transitions, so finish a task the way a
// person would rather than jumping straight to DONE.
for (const id of taskIds.slice(0, 2)) {
  for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE']) {
    const r = await api(mgr, 'PATCH', `/tasks/${id}`, { status });
    if (r.s >= 400) throw new Error(`could not move ${id} to ${status}: ${r.s} ${r.t.slice(0, 200)}`);
  }
}
console.log(`   5 tasks, 2 done -> expect 40%`);

const done = await api(mgr, 'POST', `/sprints/${sprint.id}/complete`, {});
rec(done.s < 400, 'the sprint completed', `${done.s} ${done.t.slice(0, 200)}`);
const closed = (await api(mgr, 'GET', `/sprints/${sprint.id}`)).j;
console.log(`   snapshot: ${closed?.completedTaskCount} / ${closed?.totalTaskCount}` +
  `  rolled over ${closed?.rolledOverTaskCount}  at ${closed?.completedAt}`);
rec(closed?.totalTaskCount === 5 && closed?.completedTaskCount === 2,
  'the server recorded what the sprint actually finished',
  `${closed?.completedTaskCount}/${closed?.totalTaskCount}`);
rec(closed?.rolledOverTaskCount === 3, 'and how much rolled over',
  String(closed?.rolledOverTaskCount));

// The roll-out really did happen — otherwise the snapshot is untested.
const stillIn = (await api(mgr, 'GET', `/tasks?sprintId=${sprint.id}&limit=100`)).j?.items ?? [];
console.log(`   tasks still carrying this sprintId: ${stillIn.length}`);
rec(stillIn.length < 5,
  'unfinished tasks were rolled out of the sprint (so the old filter really would read 100%)',
  `${stillIn.length} of 5 remain`);

{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/sprints/${sprint.id}/analytics`, 6000);
  const body = await page.locator('body').innerText().catch(() => '');
  const rate = body.match(/Completion Rate\s*\n?\s*(\d+)%/i)?.[1]
    ?? body.match(/(\d+)%\s*\n?\s*\d+ of \d+ tasks/i)?.[1];
  const ofLine = body.match(/(\d+) of (\d+) tasks/i);
  console.log(`   analytics reads ${rate}% (${ofLine?.[0] ?? 'n/a'})`);
  rec(rate === '40', 'the completed sprint reports the rate it actually achieved',
    `got ${rate}%, body: ${body.slice(0, 300).replace(/\n/g, ' | ')}`);
  rec(ofLine?.[1] === '2' && ofLine?.[2] === '5', 'and the counts behind it',
    ofLine?.[0] ?? body.slice(0, 200));
  rec(/rolled over/i.test(body), 'and says how much rolled over',
    body.slice(0, 300).replace(/\n/g, ' | '));

  // ---- #32 the two tabs agree about the sprint's size ---------------------
  console.log('\n===== the Board and Analytics tabs');
  await visit(page, `/sprints/${sprint.id}/board`, 6000);
  const boardBody = await page.locator('body').innerText().catch(() => '');
  const boardTotal = boardBody.match(/Board Items\s*\n?\s*(\d+)/i);
  console.log(`   board: ${boardTotal?.[0]?.replace(/\n/g, ' ') ?? 'not found'}`);
  rec(Boolean(boardTotal), 'the board card says what it counts, not "Total Tasks"',
    boardBody.slice(0, 300).replace(/\n/g, ' | '));
  rec(!/Total Tasks/i.test(boardBody),
    'the old "Total Tasks" label, which counted requirement cards as tasks, is gone',
    boardBody.slice(0, 300).replace(/\n/g, ' | '));
  const breakdown = boardBody.match(/(\d+) tasks?( · (\d+) requirements?)?/i);
  console.log(`   breakdown: ${breakdown?.[0] ?? 'none'}`);
  rec(Boolean(breakdown), 'and breaks the figure down', boardBody.slice(0, 300));
  await ctx.close();
}

// ---- #40 Recent Updates ----------------------------------------------------
console.log('\n===== "Recent Updates" on a project');
{
  // Touch the OLDEST-created task last, so board order and recency disagree.
  const oldest = taskIds[0];
  await api(mgr, 'PATCH', `/tasks/${oldest}`, { title: 'Numbers task 1 (touched last)' });

  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/projects/${p.project}`, 6000);
  const body = await page.locator('body').innerText().catch(() => '');
  rec(/changed most recently/i.test(body),
    'the card describes what it actually shows',
    body.slice(0, 400).replace(/\n/g, ' | '));
  const hasTimes = /updated\s+(about\s+)?(less than|a|\d+)/i.test(body);
  rec(hasTimes, 'every row carries when it changed — the claim is checkable',
    body.slice(0, 400).replace(/\n/g, ' | '));
  // The task touched last must be first.
  const idx = body.indexOf('touched last');
  const others = taskIds.slice(1).map((_, i) => body.indexOf(`Numbers task ${i + 2}`)).filter((n) => n >= 0);
  console.log(`   "touched last" at ${idx}, other tasks at ${JSON.stringify(others)}`);
  rec(idx >= 0 && (others.length === 0 || idx < Math.min(...others)),
    'the most recently changed item is listed first, not the first one on the board',
    `touched-last idx ${idx} vs ${JSON.stringify(others)}`);
  await ctx.close();
}

// ---- #97 the match percentage ---------------------------------------------
console.log('\n===== the search "Match: n%"');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/dashboard', 5000);
  // A term in BOTH the title and the description is what pushed the sum over 100.
  await api(mgr, 'PATCH', `/tasks/${taskIds[1]}`, {
    title: 'Kaleidoscope', description: 'Kaleidoscope kaleidoscope',
  });
  await page.waitForTimeout(1500);
  const search = page.locator('input[placeholder*="Search" i]').first();
  rec(await search.count() > 0, 'the global search box is reachable', String(await search.count()));
  if (await search.count()) {
    await search.click();
    await search.fill('Kaleidoscope');
    await page.waitForTimeout(3500);
    const body = await page.locator('body').innerText().catch(() => '');
    const matches = [...body.matchAll(/Match:\s*(\d+)%/g)].map((m) => Number(m[1]));
    console.log(`   Match figures on screen: ${JSON.stringify(matches)}`);
    rec(matches.length > 0, 'a result reported a match figure', body.slice(0, 300).replace(/\n/g, ' | '));
    rec(matches.every((n) => n >= 0 && n <= 100),
      'no match figure exceeds 100%', JSON.stringify(matches));
  }
  await ctx.close();
}

// ---- #94 the two workload panels -------------------------------------------
console.log('\n===== the two workload panels on /team');
{
  // Seven open tasks for one member: the count where the two old scales split,
  // "Moderate" in the card against "Busy" in the table below it.
  for (let i = 0; i < 7; i += 1) {
    await mustCreate(mgr, '/tasks', {
      workspaceId: p.ws, projectId: p.project,
      hierarchyId: `LOAD-${i + 1}`,
      title: `Load ${i + 1}`, status: 'TODO', priority: 'LOW', assigneeIds: [devId],
    }, `load task ${i + 1}`);
  }

  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/team', 7000);
  const body = await page.locator('body').innerText().catch(() => '');

  const BANDS = ['Available', 'Light', 'Moderate', 'Busy', 'Overloaded', 'High Load', 'Overload', 'High'];
  const seen = BANDS.filter((b) => new RegExp(`\\b${b}\\b`).test(body));
  console.log(`   band words anywhere on the page: ${JSON.stringify(seen)}`);
  rec(!/\bHigh Load\b/.test(body),
    '"High Load" is gone — it was in one panel\'s scale and not the other\'s',
    JSON.stringify(seen));

  const DEV = 'Role SOFTWARE_DEVELOPER';

  // --- the card: "<name> \n <band> \n <n> tasks \n <pct>%" ------------------
  const cardRegion = body.slice(
    body.indexOf('Resource Allocation'),
    body.indexOf('Capacity Legend'),
  );
  const cardEntry = cardRegion
    .slice(cardRegion.indexOf(DEV))
    .match(/([A-Za-z ]+)\s*\n+\s*(\d+) tasks?\s*\n+\s*(\d+)%/);
  const cardBand = cardEntry?.[1]?.trim();
  const cardTasks = cardEntry?.[2];
  const cardPct = cardEntry?.[3];
  console.log(`   card:  band="${cardBand}" tasks=${cardTasks} pct=${cardPct}%`);
  rec(Boolean(cardBand), 'the allocation card has an entry for the developer', cardRegion.slice(0, 300).replace(/\n/g, ' | '));

  // --- the table row -------------------------------------------------------
  let tableBand = null;
  let tableActive = null;
  for (const row of await page.locator('tbody tr').all()) {
    const t = await row.innerText().catch(() => '');
    if (!t.includes(DEV)) continue;
    tableBand = BANDS.find((b) => new RegExp(`\\b${b}\\b`).test(t)) ?? null;
    tableActive = t.match(/(\d+) active/)?.[1] ?? null;
    break;
  }
  console.log(`   table: band="${tableBand}" active=${tableActive}`);
  rec(Boolean(tableBand), 'the member table has a row for the developer', String(tableBand));

  rec(cardBand === tableBand,
    'both panels give the same member the same workload word',
    `card "${cardBand}" vs table "${tableBand}"`);
  rec(cardBand === 'Busy',
    'and it is the right one for seven open tasks',
    `card says "${cardBand}", expected Busy`);
  rec(cardTasks === tableActive,
    'and both count the same number of open tasks',
    `card ${cardTasks} vs table ${tableActive}`);
  rec(cardPct === '70',
    'the percentage matches the count against the same full-load constant',
    `${cardPct}% for ${cardTasks} of 10`);

  // --- the legend describes the bands actually in use ----------------------
  const legend = body.slice(body.indexOf('Capacity Legend'), body.indexOf('Team Directory'));
  console.log(`   legend: ${JSON.stringify(legend.replace(/\n/g, ' | ').slice(0, 220))}`);
  for (const label of ['Available', 'Light', 'Moderate', 'Busy', 'Overloaded']) {
    rec(new RegExp(`\\b${label}\\b`).test(legend), `the legend lists "${label}"`, legend.slice(0, 200));
  }
  rec(!/\b(High|Overload)\b(?!ed)/.test(legend),
    'and no longer lists bands that do not exist ("High", "Overload")',
    legend.replace(/\n/g, ' | ').slice(0, 200));
  rec(/tasks\)/.test(legend), 'and states its ranges in open tasks', legend.slice(0, 200));

  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

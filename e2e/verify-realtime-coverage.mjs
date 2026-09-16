// Six collections the server broadcast that nothing listened to.
//
// realtime.constants maps Epic, ClientRequirement, FunctionalRequirement,
// TimeEntry, ActivityLog and WorkspaceMember onto realtime channels, and the write
// hook emits for all of them — but use-realtime defined subscriptions only for
// tasks, sprints, projects, comments, leave and attendance. So the server did the
// work and no page was listening.
//
// The reported symptom was "deleting an epic leaves the dead card in the list".
// Each page is checked the same way: put a row on screen, change it from OUTSIDE
// the browser, and see whether the open page notices without a refresh.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('rtcover');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

/**
 * Put something on screen, change it from outside, and wait for the page to catch
 * up on its own.
 *
 * `settleMs` is generous: the invalidation is coalesced over 120ms and then has to
 * round-trip a refetch.
 */
/**
 * Wait for text to appear (or vanish), rather than sleeping a fixed time.
 *
 * The first version of this used waitForTimeout(9000-10000). That is ample when the
 * script runs alone and not always enough under whole-suite load, where it reported
 * "a member added elsewhere appears without a refresh" as a failure on a page that
 * simply had not refetched yet. Returns whether the condition held.
 */
const waitForText = async (page, text, shouldBePresent, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (body.includes(text) === shouldBePresent) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

const livesUpdate = async (label, route, seedText, mutate, settleMs = 30000) => {
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  let frames = 0;
  page.on('websocket', (s) => s.on('framereceived', (f) => {
    const d = typeof f.payload === 'string' ? f.payload : '';
    if (d.includes('"event"')) frames += 1;
  }));
  await visit(page, route, 7000);
  await page.waitForTimeout(2500);

  const before = await page.locator('body').innerText().catch(() => '');
  const present = before.includes(seedText);
  rec(present, `${label}: the row is on screen to begin with`, before.slice(0, 260).replace(/\n/g, ' | '));

  frames = 0;
  await mutate();
  const gone = await waitForText(page, seedText, false, settleMs);
  const after = await page.locator('body').innerText().catch(() => '');
  console.log(`   ${label}: ${frames} ws frames; row still visible = ${!gone}`);
  rec(frames > 0, `${label}: the change reached the browser over the socket`, `${frames} frames`);
  rec(present && gone,
    `${label}: the open page noticed without a refresh`,
    `before had it: ${present}, after gone: ${gone}`);
  await ctx.close();
};

// ---- epics — the reported case ---------------------------------------------
console.log('===== /epics');
{
  const epic = await api(mgr, 'POST', '/epics', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'RT-E1',
    name: 'Epic that gets deleted elsewhere', status: 'TODO',
  });
  rec(Boolean(epic.j?.id), 'the epic was created', `${epic.s} ${epic.t.slice(0, 160)}`);
  await livesUpdate(
    'epics',
    '/epics',
    'Epic that gets deleted elsewhere',
    () => api(mgr, 'DELETE', `/epics/${epic.j.id}`),
  );
}

// ---- client requirements ----------------------------------------------------
console.log('\n===== /requirements');
{
  const cr = await api(mgr, 'POST', '/client_requirements', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'RT-R1',
    title: 'Requirement deleted elsewhere', clientName: 'RT Co',
    priority: 'MEDIUM', status: 'DRAFT',
  });
  rec(Boolean(cr.j?.id), 'the requirement was created', `${cr.s} ${cr.t.slice(0, 160)}`);
  await livesUpdate(
    'client requirements',
    '/requirements',
    'Requirement deleted elsewhere',
    () => api(mgr, 'DELETE', `/client_requirements/${cr.j.id}`),
  );
}

// ---- the activity feed ------------------------------------------------------
// Different shape: here something must APPEAR, not disappear.
console.log('\n===== /activity');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  let frames = 0;
  page.on('websocket', (s) => s.on('framereceived', (f) => {
    const d = typeof f.payload === 'string' ? f.payload : '';
    if (d.includes('"event"')) frames += 1;
  }));
  await visit(page, '/activity', 7000);
  await page.waitForTimeout(3000);
  const before = await page.locator('body').innerText().catch(() => '');
  rec(!before.includes('Appears in the live feed'),
    'activity: the new entry is not there yet', before.slice(0, 200).replace(/\n/g, ' | '));

  frames = 0;
  await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'RT-T1',
    title: 'Appears in the live feed', status: 'TODO', priority: 'MEDIUM',
  });
  const appeared = await waitForText(page, 'Appears in the live feed', true, 30000);
  const after = await page.locator('body').innerText().catch(() => '');
  console.log(`   activity: ${frames} ws frames; entry appeared = ${appeared}`);
  rec(after.includes('Appears in the live feed'),
    'activity: a new entry appears in the feed without a refresh',
    after.slice(0, 400).replace(/\n/g, ' | '));
  await ctx.close();
}

// ---- the roster -------------------------------------------------------------
console.log('\n===== /team');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/team', 8000);
  await page.waitForTimeout(3000);
  const before = await page.locator('body').innerText().catch(() => '');
  const hadTester = before.includes('Role TESTER');
  rec(!hadTester, 'team: the tester is not on the roster yet',
    before.slice(0, 240).replace(/\n/g, ' | '));

  await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
  const appeared = await waitForText(page, 'Role TESTER', true, 30000);
  const after = await page.locator('body').innerText().catch(() => '');
  console.log(`   team: tester appeared = ${appeared}`);
  rec(after.includes('Role TESTER'),
    'team: a member added elsewhere appears without a refresh',
    after.slice(0, 400).replace(/\n/g, ' | '));
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

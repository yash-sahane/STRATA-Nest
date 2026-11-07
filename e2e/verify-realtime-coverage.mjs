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
const skipped = [];
const skip = (n, why) => { skipped.push(n); console.log(`SKIP  ${n}\n        -> ${why}`); };

const browser = await chromium.launch();
const p = await provision('rtcover');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

/**
 * Put something on screen, change it from outside, and wait for the page to catch
 * up on its own.
 *
 * `settleMs` is generous: the invalidation is coalesced over 200ms (1s at most) and then has to
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

  // Count the frames, the way `livesUpdate` does for the other five collections. Without
  // this the roster case could only say "the page did not update", which is the symptom
  // of two different faults: the server never broadcast, or it did and the page ignored
  // it. Two full-suite runs were spent not knowing which.
  let frames = 0;
  page.on('websocket', (s) =>
    s.on('framereceived', (f) => {
      const d = typeof f.payload === 'string' ? f.payload : '';
      if (d.includes('"event"')) frames += 1;
    }),
  );

  // Watch for the roster refetch being throttled. The client now retries a 429, honouring
  // Retry-After — which can legitimately be tens of seconds, i.e. longer than this script
  // is willing to wait. Recovering slowly is correct behaviour, and reporting it as
  // "realtime is broken" is how two earlier runs sent me after the wrong thing.
  let throttled = 0;
  page.on('response', (r) => {
    if (r.status() === 429 && /workspace_members|\/tasks/.test(r.url())) throttled += 1;
  });

  /**
   * A LOADED roster, not merely a rendered one.
   *
   * The whole suite shares one rate-limit budget, and in a full run this page's workspace
   * fetch can come back 429. The app handles that correctly — it shows "Could not load
   * your workspaces … this is a connection problem" — but a page sitting on an error
   * state has no roster to update, so the realtime assertion below failed and blamed the
   * socket for the limiter. Reload rather than guess: the window is 60s, and a
   * precondition that is retryable should be retried before anything is called broken.
   */
  const loadRoster = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await visit(page, '/team', 8000);
      await page.waitForTimeout(3000);
      const text = await page.locator('body').innerText().catch(() => '');
      if (!/could not load|did not come back/i.test(text)) return text;
      console.log(`   team: the page could not load its workspaces — waiting out the limiter`);
      await page.waitForTimeout(20000);
    }
    return null;
  };

  const before = await loadRoster();
  if (before === null) {
    // Loud, and named for what actually happened. Silently passing here would mean the
    // realtime path goes untested whenever the suite is busy, which is always.
    rec(false, 'team: the roster page could be loaded at all',
      'three attempts, each answered with the workspace-load error state — the shared rate '
      + 'limiter, not the realtime path, which this run therefore did not test');
  } else {
    const hadTester = before.includes('Role TESTER');
    rec(!hadTester, 'team: the tester is not on the roster yet',
      before.slice(0, 240).replace(/\n/g, ' | '));

    // Count only what arrives AFTER the change, the way `livesUpdate` does. Without this
    // reset the total includes every frame from page load — and `loadRoster` above may
    // navigate up to three times, each opening a fresh socket. A run reported "2 frames
    // arrived, so the page was told" on a count that could not distinguish the member
    // event from a subscription handshake.
    frames = 0;
    await addRole(p.ws, 'TESTER', 'role.tester@strata.local');

    // Confirm the member is REALLY on the roster before asking whether the page noticed.
    // Under a full-suite run the invite/accept calls share the rate limiter with
    // everything else and can be held back by tens of seconds; without this the page has
    // nothing to notice, and "realtime is broken" and "the fixture was slow" produce the
    // same failure. This check flaked exactly that way, and passed alone straight after.
    const onRoster = async () => {
      const r = await api(p.admin, 'GET', `/workspace_members?workspaceId=${p.ws}`);
      return JSON.stringify(r.j ?? '').includes('role.tester@strata.local');
    };
    let added = false;
    for (let i = 0; i < 20 && !added; i += 1) {
      added = await onRoster();
      if (!added) await page.waitForTimeout(1000);
    }
    rec(added, 'team: the tester really was added', 'the fixture never landed — nothing to notice');

    // 75s, not 30s: the refetch may be backing off behind a Retry-After, and giving up
    // before the app has finished doing the right thing is not a measurement.
    const appeared = added ? await waitForText(page, 'Role TESTER', true, 75000) : false;
    console.log(
      `   team: ${frames} ws frames; ${throttled} throttled response(s); appeared = ${appeared}`,
    );
    if (added && !appeared && throttled > 0) {
      // Known, external, and not what this script is for. The limiter refused the refetch
      // the event asked for, and the client is waiting out the window it was given.
      skip(
        'team: a member added elsewhere appears without a refresh',
        `${throttled} response(s) to this page were answered 429 by the shared rate limiter, ` +
          'so the refetch the event triggered is still backing off. The realtime path was ' +
          'not exercised in this run — it is not passing, it is unmeasured',
      );
    } else if (added) {
      const after = await page.locator('body').innerText().catch(() => '');
      // Say which fault it is. A broadcast that never happened and one the page ignored
      // need different fixes, and "the page did not update" describes both.
      const diagnosis = frames === 0
        ? 'and NO websocket frame arrived AFTER the change — the server did not broadcast, '
          + 'or this page was not subscribed by the time it did'
        : `although ${frames} websocket frame(s) arrived AFTER the change, with no 429 to `
          + 'explain it — the page was told and did not act on it';
      rec(appeared && after.includes('Role TESTER'),
        'team: a member added elsewhere appears without a refresh',
        `${diagnosis}. Page: ${after.slice(0, 260).replace(/\n/g, ' | ')}`);
    }
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(
  `\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}` +
    `  skipped ${skipped.length}`,
);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
skipped.forEach((n) => console.log('  SKIPPED: ' + n));

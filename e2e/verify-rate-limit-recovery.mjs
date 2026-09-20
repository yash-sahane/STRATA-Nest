// A rate-limited background refetch used to leave the page stale for ever, in silence.
//
// The query client refused to retry ANY 4xx:
//
//     if (code >= 400 && code < 500) return false;
//
// which is right for 400, 403 and 404 and exactly wrong for 429 — the one status whose
// entire meaning is "the same request will succeed later", and which ships a Retry-After
// header saying when.
//
// The cost is silent, which is how it survived. A FOREGROUND fetch that fails shows an
// error state. A BACKGROUND refetch — the kind a realtime event triggers — fails with the
// previous data still in cache, so the list just goes on showing what it showed before.
// Nothing is logged, nothing is rendered, and nobody finds out until they act on stale
// information.
//
// Measured on /team: a member added by somebody else never appeared, although the
// websocket frame HAD arrived and the page was otherwise perfectly healthy. Two full-suite
// runs were spent blaming the socket and the test harness for it.
//
// The 429 here is injected rather than provoked out of the real limiter, so the check is
// deterministic and does not need to burn 120 requests (which would punish every other
// script sharing the budget). The control below is what stops this from proving too much:
// a 403 must STILL not be retried.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();

const browser = await chromium.launch();
const p = await provision('ratelimit');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
await whoami(mgr);

// ------------------------------------------------- a 429'd refetch recovers on its own
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

  let memberCalls = 0;
  let injected = 0;
  // Fail the FIRST roster request that happens after the arming flag is set, the way the
  // limiter would, then let everything through.
  let armed = false;
  await page.route('**/workspace_members**', async (route) => {
    memberCalls += 1;
    if (armed && injected === 0) {
      injected += 1;
      await route.fulfill({
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
        body: JSON.stringify({ error: { message: 'Too many requests', code: 429, type: 'Throttled' } }),
      });
      return;
    }
    await route.continue();
  });

  await visit(page, '/team', 8000);
  await page.waitForTimeout(3000);
  const before = await page.locator('body').innerText().catch(() => '');
  rec(
    !before.includes('Role TESTER'),
    'the roster starts without the tester',
    before.slice(0, 200).replace(/\n/g, ' | '),
  );
  rec(memberCalls > 0, 'the roster endpoint is the one being intercepted', `${memberCalls} calls`);

  armed = true;
  const callsBefore = memberCalls;
  await addRole(p.ws, 'TESTER', 'role.tester@strata.local');

  // The realtime event invalidates, the refetch is answered 429, and the client has one
  // second (Retry-After) before it should try again. Allow generously more than that.
  const deadline = Date.now() + 45000;
  let appeared = false;
  while (Date.now() < deadline && !appeared) {
    const body = await page.locator('body').innerText().catch(() => '');
    appeared = body.includes('Role TESTER');
    if (!appeared) await page.waitForTimeout(500);
  }

  rec(injected === 1, 'the refetch really was rate-limited', `injected ${injected} 429(s)`);
  rec(
    memberCalls > callsBefore + 1,
    'the client tried again after the 429',
    `${memberCalls - callsBefore} request(s) after arming — one means it gave up, which is ` +
      'the bug: a background refetch that fails once stays failed and the list stays stale',
  );
  rec(
    appeared,
    'and the roster caught up on its own',
    'the tester never appeared — the refetch never recovered, and nothing on the page says so',
  );

  await ctx.close();
}

// -------------------------------------------- the control: a 403 is still not retried
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

  let calls = 0;
  await page.route('**/workspace_members**', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: { message: 'You do not have permission to perform this action.', code: 403, type: 'PermissionDenied' },
      }),
    });
  });

  await visit(page, '/team', 8000);
  await page.waitForTimeout(8000);

  // Retrying a refusal wastes requests and delays the error the person needs to see. One
  // attempt per mounted query; React strict-mode double-mounting can legitimately make it
  // two, so the assertion is on "not retried repeatedly" rather than an exact count.
  rec(
    calls > 0 && calls <= 2,
    'a 403 is answered once and not retried',
    `${calls} request(s) — a retried refusal is the behaviour the blanket 4xx rule existed ` +
      'to prevent, and it must survive the 429 exception',
  );

  const body = await page.locator('body').innerText().catch(() => '');
  rec(
    !body.includes('Role TESTER'),
    'and the refusal is not quietly ignored',
    body.slice(0, 200).replace(/\n/g, ' | '),
  );

  await ctx.close();
}

const rows = summary();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

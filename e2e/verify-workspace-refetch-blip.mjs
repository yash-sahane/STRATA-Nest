// A workspace list that fails to REFRESH must not take the app down with it.
//
// The workspace guard wraps every dashboard page and showed "Could not load your
// workspaces" whenever React Query flagged the list as errored. React Query also flags a
// failed BACKGROUND refetch that way, with the list it already had still in hand. So one
// blip in a long-open tab (an API restart during a deploy, a refetch that a realtime
// frame triggered at a bad moment) replaced whatever somebody was doing with an error
// card, over a list the page was holding. On the "No workspace open to you" screen a
// single failed 30-second poll did the same, and the polling stopped with it.
//
// What has to hold:
//   - a refetch that fails keeps the page the person was on;
//   - a FIRST load that fails still says so, and Try again still recovers.
//
// The refetch is triggered the way it happens in use: somebody joins the workspace, the
// workspace_members frame invalidates the list, and that request is made to fail. The
// number of blocked requests is checked too, so this cannot pass by blocking nothing.
import { chromium, provision, addRole, signedInPage, visit, recorder } from './kit.mjs';

const { rec, summary } = recorder();

const browser = await chromium.launch();
const p = await provision('wsblip');
await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');

const ERROR_CARD = 'Could not load your workspaces';
/** The workspace LIST (GET /workspaces?...), not one workspace by id. */
const isWorkspaceList = (url) => /\/api\/v1\/workspaces\/?$/.test(url.pathname);

try {
  console.log('\n===== a refetch that fails keeps the page');
  {
    const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
    await visit(page, '/dashboard', 5000);
    const before = await page.locator('#main-content').innerText().catch(() => '');
    rec(!before.includes(ERROR_CARD) && before.trim().length > 0,
      'the dashboard is up before anything fails', before.replace(/\s+/g, ' ').slice(0, 160));

    let blocked = 0;
    await page.route(isWorkspaceList, (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      blocked += 1;
      return route.abort('failed');
    });

    // Somebody joins: the frame invalidates every open tab's workspace list.
    await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
    for (let i = 0; i < 40 && blocked < 2; i += 1) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);

    rec(blocked >= 1, 'the workspace list was refetched, and that refetch failed',
      `${blocked} list request(s) blocked — none means the frame never asked for the list, ` +
        'and the rest of this check would prove nothing');
    const after = await page.locator('body').innerText().catch(() => '');
    rec(!after.includes(ERROR_CARD), 'the page stays instead of turning into an error card',
      after.replace(/\s+/g, ' ').slice(0, 200));
    rec((await page.locator('#main-content').count()) > 0, 'and the dashboard is still on screen',
      'the main content area is gone');
    await ctx.close();
  }

  console.log('\n===== a first load that fails still says so');
  {
    const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
    let blocked = 0;
    let failing = true;
    await page.route(isWorkspaceList, (route) => {
      if (!failing || route.request().method() !== 'GET') return route.continue();
      blocked += 1;
      return route.abort('failed');
    });
    await visit(page, '/dashboard', 4000);
    const card = page.getByText(ERROR_CARD);
    const shown = await card.waitFor({ timeout: 15000 }).then(() => true, () => false);
    rec(shown && blocked >= 1, 'a list that never arrived shows the error card',
      `card shown: ${shown}, list requests blocked: ${blocked}`);

    failing = false;
    if (shown) {
      await page.getByRole('button', { name: 'Try again' }).click();
      const gone = await card.waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false);
      // The shell mounts a moment after the card goes (the workspace provider
      // loads first), so wait for it rather than counting at once — counted
      // immediately, this failed once under load with the app on its way back.
      const back = await page
        .locator('#main-content')
        .waitFor({ state: 'attached', timeout: 15000 })
        .then(() => true, () => false);
      rec(gone && back, 'and Try again brings the app back once the list arrives',
        `card gone: ${gone}, main content back: ${back}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await p.cleanup();
}

const rows = summary();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

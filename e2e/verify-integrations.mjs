// #137 integrations accepted credentials they never checked
// #138 and there was no UI at all to configure or inspect them
//
// The test that matters is that a BAD credential is now caught and recorded, and
// that "never verified" is a distinct visible state — not that a request 200s.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, watchToasts, toasts } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('integ');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');

// ---- the API: saving is not verifying, and the verdict persists -------------
console.log('===== the API');
{
  // A token and a repo that cannot possibly work.
  const created = await api(mgr, 'POST', '/github_integrations', {
    projectId: p.project,
    repoOwner: 'strata-qa-nonexistent-owner-9f2a',
    repoName: 'definitely-not-a-real-repo-9f2a',
    accessToken: 'ghp_this_is_not_a_real_token_0000000000',
  });
  console.log(`   create: ${created.s}`);
  rec(created.s === 201, 'a GitHub integration saves', `${created.s} ${created.t.slice(0, 200)}`);
  const id = created.j?.id;

  rec(created.j?.lastTestOk === null || created.j?.lastTestOk === undefined,
    'a freshly saved credential is NOT claimed to be working',
    JSON.stringify(created.j));
  rec(!('accessToken' in (created.j ?? {})),
    'and the token is never echoed back', JSON.stringify(created.j).slice(0, 200));

  // The test route now exists, and says no.
  const tested = await api(mgr, 'POST', `/github_integrations/${id}/test`, {});
  console.log(`   test: ${tested.s} ${JSON.stringify(tested.j)}`);
  rec(tested.s === 201 || tested.s === 200, 'the test route exists',
    `${tested.s} ${tested.t.slice(0, 200)}`);
  rec(tested.j?.ok === false, 'a bad credential is reported as NOT working',
    JSON.stringify(tested.j));
  rec(typeof tested.j?.detail === 'string' && tested.j.detail.length > 10,
    'and the reason says what is wrong', String(tested.j?.detail));

  // The verdict survives the response — which is the point of persisting it.
  const reread = await api(mgr, 'GET', `/github_integrations/${id}`);
  console.log(`   reread: lastTestOk=${reread.j?.lastTestOk} at=${reread.j?.lastTestedAt}`);
  rec(reread.j?.lastTestOk === false, 'the verdict is still there on a later read',
    JSON.stringify(reread.j));
  rec(Boolean(reread.j?.lastTestedAt), 'with when it was checked', String(reread.j?.lastTestedAt));
  rec(typeof reread.j?.lastTestError === 'string' && reread.j.lastTestError.length > 0,
    'and why it failed', String(reread.j?.lastTestError));

  // A Discord webhook pointing somewhere that is not Discord must be refused
  // without the server making the request.
  const disc = await api(mgr, 'POST', '/discord_integrations', {
    projectId: p.project,
    webhookUrl: 'http://127.0.0.1:8000/api/v1/health',
  });
  if (disc.s === 201) {
    const dt = await api(mgr, 'POST', `/discord_integrations/${disc.j.id}/test`, {});
    console.log(`   discord test: ${JSON.stringify(dt.j)}`);
    rec(dt.j?.ok === false && /not Discord/i.test(dt.j?.detail ?? ''),
      'a webhook URL that is not Discord is refused without calling it',
      JSON.stringify(dt.j));
  } else {
    rec(false, 'the Discord integration could be created for the SSRF check',
      `${disc.s} ${disc.t.slice(0, 200)}`);
  }

  // A member without integration:write must not be able to run the test.
  const asDev = await api(dev, 'POST', `/github_integrations/${id}/test`, {});
  console.log(`   as SOFTWARE_DEVELOPER: ${asDev.s}`);
  rec(asDev.s === 403 || asDev.s === 404,
    'a member without integration:write cannot run the test',
    `${asDev.s} ${asDev.t.slice(0, 200)}`);
}

// ---- the UI ---------------------------------------------------------------
console.log('\n===== Settings -> Integrations');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/settings', 6000);
  await watchToasts(page);

  const tab = page.getByRole('tab', { name: /integrations/i }).first();
  rec(await tab.count() > 0, 'there is an Integrations tab at all', String(await tab.count()));
  await tab.click();
  await page.waitForTimeout(4000);

  const body = await page.locator('body').innerText().catch(() => '');
  for (const provider of ['GitHub', 'GitLab', 'Discord']) {
    rec(new RegExp(provider).test(body), `${provider} can be configured`, body.slice(0, 300));
  }

  // The integration saved above is listed, with its failed verdict and reason.
  rec(/Not working/i.test(body), 'the failing integration is shown as not working',
    body.slice(0, 600).replace(/\n/g, ' | '));
  rec(/is visible to this token|token was rejected|answered 4/i.test(body),
    'and the reason is on screen, not just the verdict',
    body.slice(0, 800).replace(/\n/g, ' | '));

  // "Not verified" must exist as its own state: the GitLab section has no
  // integration, so create one and check it reads as unverified rather than fine.
  const pathField = page.locator('#gitlab-projectPath');
  rec(await pathField.count() > 0, 'the GitLab form is present', String(await pathField.count()));
  if (await pathField.count()) {
    await pathField.fill('strata-qa/definitely-not-real-9f2a');
    await page.locator('#gitlab-accessToken').fill('glpat-not-a-real-token-000000');
    await page.getByRole('button', { name: /connect gitlab/i }).first().click();
    await page.waitForTimeout(4000);
    const after = await page.locator('body').innerText().catch(() => '');
    rec(/Not verified/i.test(after),
      'a newly saved credential reads "Not verified", not "Working"',
      after.slice(0, 600).replace(/\n/g, ' | '));
    const saved = await toasts(page);
    console.log(`   toasts: ${JSON.stringify(saved)}`);
    rec(saved.some((t) => /does not check|Test connection/i.test(t)),
      'and the user is told that saving did not verify it',
      JSON.stringify(saved));

    // Now press Test connection and watch it become "Not working".
    const testBtns = page.getByRole('button', { name: /test connection/i });
    console.log(`   Test connection buttons: ${await testBtns.count()}`);
    rec(await testBtns.count() >= 2, 'each integration offers a Test connection button',
      String(await testBtns.count()));
    await testBtns.last().click();
    await page.waitForTimeout(8000);
    const tested = await page.locator('body').innerText().catch(() => '');
    const notVerified = (tested.match(/Not verified/gi) ?? []).length;
    const notWorking = (tested.match(/Not working/gi) ?? []).length;
    console.log(`   after testing: "Not verified"x${notVerified} "Not working"x${notWorking}`);
    rec(notWorking >= 2, 'testing turns "Not verified" into a real verdict',
      `not-verified ${notVerified}, not-working ${notWorking}`);
  }

  // The token must not be readable anywhere in the DOM.
  const html = await page.content();
  rec(!/ghp_this_is_not_a_real_token/.test(html) && !/glpat-not-a-real-token/.test(html),
    'no access token is present in the page source',
    'a token string was found in the DOM');
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

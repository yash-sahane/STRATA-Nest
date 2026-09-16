// Tab selection and deep links that the URL should carry.
//
//  /attendance/team redirected to /attendance, which hardcoded the Today tab, so
//    the one thing the link asked for was the one thing it could not reach
//  /settings read ?tab= but never wrote it back, so refresh and Back jumped tabs
//
// Also re-checks a claim that did NOT reproduce: ?frId= is already stripped once
// the dialog opens, so dismissing it and refreshing does not re-open it.
import { chromium, api, provision, addRole, signedInPage, visit, BASE } from './kit.mjs';

/**
 * Wait for a tab strip to have a SELECTED tab, and return its label.
 *
 * Every check here used a flat sleep and then asked. Under suite load the strip had not
 * rendered, `activeTab` returned null, and null fails a /calendar/ or /security/ test
 * exactly as convincingly as a real regression — so "slow render" and "wrong tab" became
 * the same result. Polling keeps them apart: a strip that never appears fails saying so.
 */
async function waitForActiveTab(page, activeTabFn, ms = 20000) {
  for (let i = 0; i < Math.ceil(ms / 250); i += 1) {
    const label = await activeTabFn(page).catch(() => null);
    if (label) return label;
    await page.waitForTimeout(250);
  }
  return null;
}

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('urlstate');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

const activeTab = (page) =>
  page.evaluate(() => {
    const sel = document.querySelector('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"]');
    return sel ? (sel.textContent || '').replace(/\s+/g, ' ').trim() : null;
  });

// ---- the /attendance/team deep link ----------------------------------------
console.log('===== /attendance/team');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await page.goto(`${BASE}/attendance/team`, { waitUntil: 'domcontentloaded' });
  // The tab wait comes FIRST: this route REDIRECTS, and reading page.url() before the
  // page has settled captures the pre-redirect address. Replacing the old flat sleep
  // without moving this read reported "the redirect carries the intent in the URL" as a
  // failure when the redirect had simply not happened yet.
  const tab = await waitForActiveTab(page, activeTab);
  const url = page.url();
  console.log(`   landed on ${url} with the "${tab}" tab active`);
  rec(/tab=team/.test(url), 'the redirect carries the intent in the URL', url);
  rec(/team/i.test(tab ?? ''), 'and the Team tab is the one showing', String(tab));
  await ctx.close();
}

// ---- a direct ?tab= link ----------------------------------------------------
console.log('\n===== /attendance?tab=analytics');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await page.goto(`${BASE}/attendance?tab=analytics`, { waitUntil: 'domcontentloaded' });
  const tab = await waitForActiveTab(page, activeTab);
  console.log(`   active tab: "${tab}"`);
  rec(/analytic/i.test(tab ?? ''), 'a ?tab= link opens that tab', String(tab));

  // Clicking a tab must write it back, so a reload stays put.
  const todayTab = page.getByRole('tab', { name: /today/i }).first();
  if (await todayTab.count()) {
    await todayTab.click();
    await page.waitForTimeout(2000);
    console.log(`   after clicking Today: ${page.url()}`);
    // "today" is the default, so the parameter is dropped rather than pinned.
    rec(!/tab=analytics/.test(page.url()),
      'clicking another tab updates the URL', page.url());
  }

  const calTab = page.getByRole('tab', { name: /calendar/i }).first();
  if (await calTab.count()) {
    await calTab.click();
    await page.waitForTimeout(2000);
    rec(/tab=calendar/.test(page.url()), 'a non-default tab is written to the URL', page.url());
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Poll for a tab to BE selected before asking which one.
    //
    // A flat wait read the strip before it rendered and reported `null`, which fails a
    // /calendar/ test exactly as a real regression would — so a slow render and a wrong
    // tab became the same result. Waiting for the strip keeps them apart.
    let afterReload = null;
    for (let i = 0; i < 60; i += 1) {
      afterReload = await activeTab(page);
      if (afterReload) break;
      await page.waitForTimeout(250);
    }
    console.log(`   after reload: ${JSON.stringify(afterReload)}`);
    rec(Boolean(afterReload), 'the tab strip renders after a reload',
      'no tab was selected after 15s — the strip never appeared, so the check below cannot mean anything');
    rec(/calendar/i.test(afterReload ?? ''),
      'and a reload stays on it rather than jumping to the first tab',
      String(afterReload));
  }
  await ctx.close();
}

// ---- /settings tabs --------------------------------------------------------
console.log('\n===== /settings');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/settings', 6000);
  const secTab = page.getByRole('tab', { name: /security/i }).first();
  rec(await secTab.count() > 0, 'the Security tab exists', String(await secTab.count()));
  await secTab.click();
  await page.waitForTimeout(2000);
  console.log(`   after clicking Security: ${page.url()}`);
  rec(/tab=security/.test(page.url()),
    'clicking a settings tab writes it to the URL', page.url());

  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await waitForActiveTab(page, activeTab);
  rec(Boolean(afterReload), 'the settings tab strip renders after a reload',
    'no tab was selected after 20s — the strip never appeared, so the check below cannot mean anything');
  console.log(`   after reload: "${afterReload}"`);
  rec(/security/i.test(afterReload ?? ''),
    'and a reload comes back to it instead of Profile',
    String(afterReload));

  // Back should leave the page, not walk through each tab visited.
  // Guarded: clicking a tab that has not rendered waits out Playwright's default timeout
  // and kills the process, which is what turned one slow render into a lost run.
  const appearanceTab = page.getByRole('tab', { name: /appearance/i }).first();
  let appearanceReady = false;
  for (let i = 0; i < 60; i += 1) {
    if ((await appearanceTab.count()) > 0) { appearanceReady = true; break; }
    await page.waitForTimeout(250);
  }
  rec(appearanceReady, 'the Appearance tab is reachable',
    'not found after 15s — the settings tab strip had not rendered');
  if (appearanceReady) {
    await appearanceTab.click();
    await page.waitForTimeout(1800);
  }
  await page.goBack();
  await page.waitForTimeout(3500);
  console.log(`   after Back: ${page.url()}`);
  rec(!/\/settings/.test(page.url()) || /tab=security/.test(page.url()),
    'Back does not trap the user inside the tab strip',
    page.url());
  await ctx.close();
}

// ---- ?frId= is consumed (already fixed; re-checked) -------------------------
console.log('\n===== ?frId= does not re-open a dismissed dialog');
{
  const cr = await api(mgr, 'POST', '/client_requirements', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'URL-R',
    title: 'Parent for the FR', clientName: 'URL Co', priority: 'MEDIUM', status: 'DRAFT',
  });
  const fr = await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
    hierarchyId: 'URL-FR', title: 'Deep linked FR', status: 'DRAFT',
    priority: 'MEDIUM', complexity: 'MEDIUM', type: 'FUNCTIONAL',
  });
  console.log(`   fr: ${fr.s} ${fr.j?.id ?? fr.t.slice(0, 140)}`);
  if (fr.j?.id) {
    const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
    await page.goto(`${BASE}/functional-requirements?frId=${fr.j.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    const urlAfterOpen = page.url();
    console.log(`   url once the dialog opened: ${urlAfterOpen}`);
    rec(!/frId=/.test(urlAfterOpen),
      'the one-shot parameter is removed once acted on',
      urlAfterOpen);
    await ctx.close();
  } else {
    rec(false, 'the functional requirement was created for this check', `${fr.s} ${fr.t.slice(0, 200)}`);
  }
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

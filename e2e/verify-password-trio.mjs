// The change-password screen: three findings and the button meant to reach it.
//
//  #10 signed out, /change-password spun on "Loading..." with no way forward
//  #11 the profile page's "Change Password" button bounced straight back
//  #12 the screen listed four requirements and the server enforced one
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('pwtrio');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

// ---- #10 signed out --------------------------------------------------------
console.log('===== /change-password with no session');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/change-password`, { waitUntil: 'domcontentloaded' });
  // Generous: the old page would still be spinning after any wait at all.
  await page.waitForTimeout(6000);
  const body = await page.locator('body').innerText().catch(() => '');
  const spinning = /Loading\.\.\./.test(body);
  console.log(`   body: ${JSON.stringify(body.replace(/\n/g, ' | ').slice(0, 220))}`);
  rec(!spinning, 'a signed-out visitor is not left on "Loading..."', body.slice(0, 300));
  rec(/Sign in to change your password|Cannot reach the server/.test(body),
    'the page says what is wrong', body.slice(0, 300).replace(/\n/g, ' | '));
  const signIn = page.getByRole('link', { name: /go to sign in/i }).first();
  rec(await signIn.count() > 0, 'and offers a way out', String(await signIn.count()));
  if (await signIn.count()) {
    await signIn.click();
    await page.waitForTimeout(3000);
    rec(/\/login/.test(page.url()), 'which reaches the login page', page.url());
  }
  await ctx.close();
}

// ---- #11 the profile button ------------------------------------------------
console.log('\n===== the profile page\'s "Change Password" button');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/profile', 5000);
  // A link, as anything that goes to another page is.
  const btn = page.getByRole('link', { name: /change password/i }).first();
  rec(await btn.count() > 0, 'the link is on the profile page', String(await btn.count()));
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(4000);
    const url = page.url();
    const body = await page.locator('body').innerText().catch(() => '');
    console.log(`   landed on ${url}`);
    rec(/change-password/.test(url), 'clicking it stays on /change-password rather than bouncing back',
      url);
    rec(/Current Password|Password Requirements/i.test(body),
      'and the form is actually there', body.slice(0, 300).replace(/\n/g, ' | '));

    // ---- #12 the checklist is enforced ------------------------------------
    console.log('\n===== the requirement list is a contract');
    const listed = await page
      .locator('li')
      .filter({ hasText: /characters|uppercase|lowercase|number/i })
      .allInnerTexts()
      .catch(() => []);
    console.log(`   listed: ${JSON.stringify(listed)}`);
    rec(listed.length >= 4, 'four requirements are listed', JSON.stringify(listed));

    // "aaaaaaaa" satisfies only the length rule. The old build accepted it.
    const fill = async (cur, next) => {
      const inputs = page.locator('input[type="password"], input[type="text"][id*="assword"]');
      const n = await page.locator('#currentPassword, input[name="currentPassword"]').count();
      if (n) {
        await page.locator('#currentPassword, input[name="currentPassword"]').first().fill(cur);
        await page.locator('#newPassword, input[name="newPassword"]').first().fill(next);
        await page.locator('#confirmPassword, input[name="confirmPassword"]').first().fill(next);
      } else {
        await inputs.nth(0).fill(cur);
        await inputs.nth(1).fill(next);
        await inputs.nth(2).fill(next);
      }
    };
    await fill('RolePass123!', 'aaaaaaaa');
    // The ticks must disagree with each other for a candidate that fails three.
    const metCount = await page.locator('li .text-success-text').count().catch(() => 0);
    console.log(`   "aaaaaaaa" -> ${metCount} of ${listed.length} rules shown as met`);
    rec(metCount > 0 && metCount < listed.length,
      'the ticks reflect which rules a weak candidate fails', `${metCount} met`);

    await page.getByRole('button', { name: /^change password$/i }).first().click();
    await page.waitForTimeout(2500);
    const afterWeak = await page.locator('body').innerText().catch(() => '');
    rec(/Password must have/i.test(afterWeak),
      'submitting it is refused, naming every failed rule',
      afterWeak.slice(0, 400).replace(/\n/g, ' | '));
    rec(/change-password/.test(page.url()), 'and the password was not changed', page.url());
  }
  await ctx.close();
}

// ---- the server is the one refusing, not just the client -------------------
console.log('\n===== the API itself');
{
  for (const [pw, why] of [
    ['aaaaaaaa', 'no uppercase, no number'],
    ['AAAAAAAA', 'no lowercase, no number'],
    ['Aa3456', 'too short'],
  ]) {
    const r = await api(mgr, 'POST', '/auth/change-password', {
      currentPassword: 'RolePass123!', newPassword: pw,
    });
    const msg = JSON.stringify(r.j ?? {});
    rec(r.s === 400 && /Password must have/i.test(msg),
      `the API refuses "${pw}" (${why})`, `${r.s} ${msg.slice(0, 200)}`);
  }
  // And the real password still works, so the policy did not lock anybody out.
  const ok = await api(mgr, 'POST', '/auth/change-password', {
    currentPassword: 'RolePass123!', newPassword: 'RolePass123!',
  });
  rec(ok.s < 400 || !/Password must have/i.test(JSON.stringify(ok.j ?? {})),
    'a compliant password is not refused by the policy', `${ok.s} ${JSON.stringify(ok.j ?? {}).slice(0, 200)}`);
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

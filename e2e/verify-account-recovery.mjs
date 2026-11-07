// An account that cannot be signed in to can be recovered; and a colleague's
// account is not everybody's to read.
//
//  - A new account's first password existed in one place: the welcome mail, or —
//    where mail is not delivered — the dialog of whoever created the account.
//    Lose it and the account could never be opened; there was no way to issue
//    another. And nothing on the roster said who had never got in.
//
//  - "Forgot password" answered "a reset link is on its way" on an installation
//    that cannot send mail at all.
//
//  - GET /users handed every member the full account record of everybody they
//    shared a workspace with: every other workspace that person belongs to,
//    whether they are a platform administrator, and whether they are still on a
//    temporary password.
//
//  One persistent test account is used (e2e.recovery@strata.local) and put back
//  into the "never signed in" state at the end, so runs do not pile accounts up.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, API } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const flat = (text) => String(text).replace(/\s+/g, ' ');
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const EMAIL = 'e2e.recovery@strata.local';

/** One sign-in attempt, straight at the API. Waits out the login limiter. */
async function signIn(email, password) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 12000)); continue; }
    const jar = new Map();
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: r.status, jar };
  }
  return { status: 429, jar: new Map() };
}

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('recovery');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const adminId = await whoami(admin);

// ---- somebody is added, and never gets in --------------------------------------
console.log('===== somebody who was added and never signed in');
const invited = await api(mgr, 'POST', '/users/invite', {
  workspaceId: p.ws, name: 'E2E Recovery', email: EMAIL, roleName: 'MEMBER',
});
rec(invited.s === 201 || invited.s === 200, 'a manager adds a person', brief(invited));
const personId = invited.j?.userId;
// A run that died half-way can leave the account with a password of its own;
// put it back to "never signed in" so every run starts from the same place.
{
  const reset = await api(admin, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
  rec(reset.s < 300, 'the account is on a temporary password nobody has', brief(reset));
}
const delivers = invited.j?.emailSent === true;
console.log(`   this installation ${delivers ? 'sends' : 'does not send'} email`);

const rosterAs = async (jar) =>
  list((await api(jar, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j)
    .find((m) => m.userId === personId);
rec((await rosterAs(mgr))?.awaitingFirstSignIn === true,
  'whoever manages members is told they have not signed in yet', JSON.stringify(await rosterAs(mgr)));
rec((await rosterAs(dev))?.awaitingFirstSignIn === false,
  'somebody who cannot act on it is not', JSON.stringify(await rosterAs(dev)));

{
  const denied = await api(dev, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
  rec(denied.s === 403, 'a member without member:update cannot issue a password', brief(denied));
}

const issued = await api(mgr, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
rec(issued.s < 300 && issued.j?.userId === personId, 'the manager issues a new temporary password', brief(issued));
if (!delivers) {
  const password = issued.j?.temporaryPassword;
  rec(typeof password === 'string' && password.length >= 12,
    'where mail is not delivered it is handed back, once, to pass on by hand',
    JSON.stringify(Object.keys(issued.j ?? {})));
  const first = await signIn(EMAIL, password);
  rec(first.status === 200 || first.status === 201, 'the person can sign in with it', `login ${first.status}`);
  const me = (await api(first.jar, 'GET', '/auth/me')).j;
  rec(me?.hasTempPassword === true, 'and will be made to choose their own', JSON.stringify({ hasTempPassword: me?.hasTempPassword }));

  // A second issue replaces the first: the old one stops working at once.
  const again = await api(mgr, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
  const stale = await signIn(EMAIL, password);
  // The API answers a wrong password with a 4xx and sets no session.
  rec(again.s < 300 && stale.status >= 400 && stale.status < 500 && stale.jar.size === 0,
    'a newer one replaces it: the old password no longer works',
    `reissue ${again.s}, old password login ${stale.status}, cookies ${stale.jar.size}`);

  // Once the person has set their own, the account is theirs.
  const fresh = await signIn(EMAIL, again.j?.temporaryPassword);
  const changed = await api(fresh.jar, 'POST', '/auth/change-password', {
    currentPassword: again.j?.temporaryPassword, newPassword: 'Chosen-By-Me-4471',
  });
  rec(changed.s < 300, 'the person chooses their own password', brief(changed));
  const tooLate = await api(mgr, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
  rec(tooLate.s === 403 && /already set their own password/.test(tooLate.t),
    'after which a workspace manager can no longer reset it', brief(tooLate));
  rec((await rosterAs(mgr))?.awaitingFirstSignIn === false,
    'and the roster stops saying they have not signed in');
} else {
  rec(issued.j?.emailSent === true && !('temporaryPassword' in (issued.j ?? {})),
    'it is mailed to the person and returned to nobody', JSON.stringify(issued.j));
}

// ---- what a colleague can read ------------------------------------------------------
console.log('===== a colleague\'s account, as a colleague sees it');
{
  const mine = (await api(dev, 'GET', '/auth/me')).j;
  const myWorkspaces = new Set(mine?.workspaceIds ?? []);
  const boss = (await api(dev, 'GET', `/users/${adminId}`)).j;
  rec(Boolean(boss?.name) && Boolean(boss?.email), 'a colleague still has a name and an address', JSON.stringify(boss).slice(0, 200));
  rec(boss?.isAdmin === false,
    'whether they are a platform administrator is not on offer', `isAdmin=${boss?.isAdmin}`);
  rec((boss?.workspaceIds ?? []).every((id) => myWorkspaces.has(id)),
    'nor are the workspaces they are in that the reader is not',
    `theirs: ${JSON.stringify(boss?.workspaceIds)} mine: ${JSON.stringify([...myWorkspaces])}`);
  const everyone = list((await api(dev, 'GET', '/users?limit=200')).j);
  const leaks = everyone.filter((u) => u.id !== mine?.user?.id && u.id !== mine?.id &&
    (u.isAdmin === true || u.hasTempPassword === true || (u.workspaceIds ?? []).some((id) => !myWorkspaces.has(id))));
  rec(everyone.length > 1 && leaks.length === 0,
    'and the same holds for every row of the directory',
    `${leaks.length} of ${everyone.length} rows say more: ${JSON.stringify(leaks.slice(0, 2)).slice(0, 240)}`);
  const whole = (await api(admin, 'GET', `/users/${adminId}`)).j;
  rec(whole?.isAdmin === true, 'the account\'s owner still reads their own in full', `isAdmin=${whole?.isAdmin}`);
}

// ---- the screens ---------------------------------------------------------------------
// Back to "never signed in", so the roster has somebody to show.
const restored = await api(admin, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });

console.log('===== the roster, and the way back in');
const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/team', 8000);
{
  const row = page.locator('tbody tr', { hasText: EMAIL }).first();
  const listed = await row.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(listed, 'the person is on the roster');
  if (listed) {
    rec(/Hasn.t signed in yet/.test(flat(await row.innerText())),
      'marked as somebody who has not signed in yet', flat(await row.innerText()).slice(0, 200));
    await row.getByRole('button', { name: /member actions/i }).click();
    const action = page.getByRole('menuitem', { name: 'New Temporary Password' });
    const offered = await action.waitFor({ timeout: 8000 }).then(() => true, () => false);
    rec(offered, 'with a way to issue them a new temporary password');
    if (offered) {
      await action.click();
      await page.waitForTimeout(3000);
      const body = flat(await page.locator('main').innerText().catch(() => ''));
      if (delivers) {
        rec(/emailed to/i.test(flat(await page.locator('body').innerText())), 'which is emailed to them');
      } else {
        rec(new RegExp(EMAIL.replace(/\./g, '\\.')).test(body) && /temporary password/i.test(body),
          'which is shown, once, to pass on — this installation cannot mail it', body.slice(0, 400));
      }
    }
  }
}
await ctx.close();

console.log('===== "forgot password", where no mail can be sent');
{
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const forgot = await anon.newPage();
  await forgot.goto('http://localhost:3000/forgot-password', { waitUntil: 'domcontentloaded' });
  // Typed before the page has hydrated, the address never reaches the form's
  // state and the button stays disabled: wait for it to settle first.
  await forgot.waitForLoadState('networkidle').catch(() => {});
  await forgot.waitForTimeout(2500);
  // An address of this run's own: reset requests are limited to three an hour
  // per address, and the answer is the same whoever is asked about.
  await forgot.locator('#email').fill(`e2e.forgot.${Date.now()}@strata.local`);
  const send = forgot.getByRole('button', { name: 'Send reset link' });
  const ready = await send.isEnabled({ timeout: 8000 }).catch(() => false);
  rec(ready, 'the forgot-password form takes an address');
  if (ready) await send.click();
  await forgot.waitForTimeout(3500);
  const text = flat(await forgot.locator('body').innerText().catch(() => ''));
  if (delivers) {
    rec(/Check your email/.test(text), 'where mail is delivered, it says a link is on its way', text.slice(0, 300));
  } else {
    rec(/cannot send email|Email is not set up/.test(text) && /Ask a platform administrator/.test(text),
      'it says no link was sent, and who can help instead', text.slice(0, 400));
    rec(!/on its way/.test(text), 'and does not promise one', text.slice(0, 300));
  }
  await anon.close();
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));
// Leave the account as it was found: on a temporary password nobody has.
await api(admin, 'POST', `/users/${personId}/temp-password`, { workspaceId: p.ws });
void restored;

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

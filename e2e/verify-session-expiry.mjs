// Does a form survive its own session expiring?
//
// The access token lasts 900 seconds. A dialog left open while somebody reads a spec, or
// takes a call, outlives it easily — and then they press Save. Whether their typing
// survives depends on the 401 refresh-and-retry in rest-client actually covering
// MUTATIONS, replaying the body, and re-sending a CSRF header that is still valid after
// the refresh rotated the cookies.
//
// I read that interceptor earlier, judged it thorough, and concluded this was "probably
// fine" without testing it. That inference is the one move this whole exercise keeps
// proving wrong, so here it is measured.
//
// An expired access token is simulated by DELETING the `strata_access` cookie while
// leaving `strata_refresh` in place — which is exactly the state the browser is in once
// the access token's 900s are up, without waiting them out.
//
// Both directions are tested, because only the pair is meaningful:
//   recoverable    access gone, refresh valid   -> the save must go through silently
//   unrecoverable  both gone                    -> it must FAIL LOUDLY, not swallow the
//                                                  work or pretend it saved
import { chromium, api, provision, addRole, signedInPage, visit, whoami,
  watchToasts, toasts } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };

const ACCESS = 'strata_access';
const REFRESH = 'strata_refresh';

const browser = await chromium.launch();
const p = await provision('sessexp');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
void (await whoami(mgr));

// A FRESH session, not the cached one. Refresh tokens rotate and the old jti is revoked,
// so a cached jar's refresh cookie may already have been spent by an earlier run — which
// made this very check pass once and then report `ErrorUnauthorized` on the next run, with
// nothing changed in the app. That was replay detection working correctly on a token the
// harness had already used.
const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws, { fresh: true });

const until = async (fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

const cookieNames = async () => (await ctx.cookies()).map((c) => c.name);

/** Drop the access cookie, keeping the refresh one: an expired access token. */
const expireAccessToken = async () => {
  const all = await ctx.cookies();
  await ctx.clearCookies();
  await ctx.addCookies(all.filter((c) => c.name !== ACCESS));
};

/** Drop both: a session that cannot be recovered at all. */
const destroySession = async () => {
  const all = await ctx.cookies();
  await ctx.clearCookies();
  await ctx.addCookies(all.filter((c) => c.name !== ACCESS && c.name !== REFRESH));
};

// ===========================================================================
// 1. A filled-in form, submitted after the access token has expired
// ===========================================================================
console.log('===== a create dialog submitted with an expired access token');
const TITLE = `Survives expiry ${Date.now().toString(36)}`;
{
  await visit(page, '/requirements', 9000);
  const opener = page.getByRole('button', { name: /new client requirement|new requirement/i }).first();
  rec(await opener.count() > 0, 'the create-requirement dialog can be opened', String(await opener.count()));
  await opener.click();
  rec(Boolean(await until(async () =>
    (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 12000)),
    'the dialog is open', '');

  // Fill it the way a person would, skipping anything the app disabled on purpose —
  // Client Name is `disabled={!!clientName}` and auto-filled from project settings, so
  // trying to type into it just times out.
  const dialog = page.locator('[role="dialog"]:visible').first();
  const fillIfEditable = async (locator, value, label) => {
    if (!(await locator.count())) return `${label}: absent`;
    const editable = await locator.first().evaluate(
      (el) => !el.disabled && !el.readOnly,
    ).catch(() => false);
    if (!editable) return `${label}: locked (left as the app set it)`;
    await locator.first().fill(value);
    return `${label}: typed`;
  };

  const filled = [];
  filled.push(await fillIfEditable(dialog.locator('#title, input[name="title"]'), TITLE, 'title'));
  filled.push(await fillIfEditable(
    dialog.locator('#description, textarea[name="description"]'),
    'Typed before the session expired.', 'description'));
  filled.push(await fillIfEditable(
    dialog.locator('#clientName, input[name="clientName"]'), 'Expiry Co', 'clientName'));
  console.log(`   form: ${filled.join(' | ')}`);

  const typedTitle = await dialog.locator('#title, input[name="title"]').first()
    .inputValue().catch(() => '');
  rec(typedTitle === TITLE, 'the title was entered', `"${typedTitle}"`);

  console.log(`   cookies before: ${JSON.stringify(await cookieNames())}`);
  await expireAccessToken();
  const after = await cookieNames();
  console.log(`   cookies after expiring the access token: ${JSON.stringify(after)}`);
  rec(!after.includes(ACCESS) && after.includes(REFRESH),
    'the access cookie is gone and the refresh cookie remains — an expired session',
    JSON.stringify(after));

  // The typing must still be on screen; losing it before submit would be its own bug.
  const stillTyped = await dialog.locator('#title, input[name="title"]').first()
    .inputValue().catch(() => '');
  rec(stillTyped === TITLE, 'the typed title is still in the form after the expiry',
    `"${stillTyped}" — losing it before submit would be its own bug`);

  // Record every toast from before the click, rather than sampling the DOM afterwards:
  // sonner dismisses in about four seconds, so a later look cannot tell "nothing was
  // said" from "it was said and expired".
  await watchToasts(page);

  // Submit.
  const save = dialog.getByRole('button', { name: /create|save|submit/i }).last();
  rec(await save.count() > 0, 'the dialog offers a submit control', String(await save.count()));
  await save.click();

  // The record must exist afterwards. That is the whole question.
  const created = await until(async () => {
    const r = await api(mgr, 'GET', `/client_requirements?workspaceId=${p.ws}`);
    const hit = (r.j?.items ?? []).find((x) => x.title === TITLE);
    return hit ?? null;
  }, 25000);
  rec(Boolean(created),
    'the save goes through: the refresh-and-retry replayed the mutation',
    created ? '' : `no requirement titled "${TITLE}" exists — the user's work was lost`);

  // And a new access cookie proves a refresh actually happened, rather than the
  // server having accepted the request without one.
  const post = await cookieNames();
  console.log(`   cookies after submitting: ${JSON.stringify(post)}`);
  rec(post.includes(ACCESS),
    'and a fresh access cookie was issued, so the recovery was a real refresh',
    JSON.stringify(post));

  // The user must not have been thrown out.
  console.log(`   url after submitting: ${page.url().replace('http://localhost:3000', '')}`);
  rec(!/\/login/.test(page.url()),
    'the user is not bounced to /login by a recoverable expiry',
    page.url());

  const shown = await toasts(page);
  console.log(`   toasts raised during the recovery: ${JSON.stringify(shown)}`);
  const alarming = shown.filter((t) => /expired|sign in|signed out|unauthor|session/i.test(t));
  rec(alarming.length === 0,
    'and is not told anything alarming about a recovery that worked',
    JSON.stringify(alarming));
}

// ===========================================================================
// 2. The same thing with NO way back: it must fail loudly
// ===========================================================================
console.log('\n===== a submit with the whole session destroyed');
{
  await visit(page, '/requirements', 9000);
  const opener = page.getByRole('button', { name: /new client requirement|new requirement/i }).first();
  if (!(await opener.count())) {
    rec(false, 'the create dialog can be reopened for the unrecoverable case', 'no opener');
  } else {
    await opener.click();
    await until(async () => (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 12000);
    const dialog = page.locator('[role="dialog"]:visible').first();
    const DOOMED = `Cannot survive ${Date.now().toString(36)}`;
    await dialog.locator('#title, input[name="title"]').first().fill(DOOMED);
    const desc2 = dialog.locator('#description, textarea[name="description"]').first();
    if (await desc2.count()) {
      const editable = await desc2.evaluate((el) => !el.disabled && !el.readOnly).catch(() => false);
      if (editable) await desc2.fill('This one has no refresh cookie to fall back on.');
    }

    await destroySession();
    const gone = await cookieNames();
    console.log(`   cookies: ${JSON.stringify(gone)}`);
    rec(!gone.includes(ACCESS) && !gone.includes(REFRESH),
      'both session cookies are gone — nothing to recover with',
      JSON.stringify(gone));

    await watchToasts(page);
    const save = dialog.getByRole('button', { name: /create|save|submit/i }).last();
    await save.click();
    await page.waitForTimeout(6000);
    const raised = await toasts(page);

    // It must NOT have been created.
    const r = await api(mgr, 'GET', `/client_requirements?workspaceId=${p.ws}`);
    const leaked = (r.j?.items ?? []).some((x) => x.title === DOOMED);
    rec(!leaked, 'nothing is created without a session', `"${DOOMED}" exists but should not`);

    // And the app must SAY something, or send the user to sign in again. Silence here
    // is the bad outcome: the dialog closing as though it saved would lose the work
    // without telling anyone.
    const said = await page.evaluate(() => {
      const body = (document.body.innerText || '');
      return {
        onScreenNow: Array.from(document.querySelectorAll('[data-sonner-toast]'))
          .map((t) => (t.textContent || '').trim()),
        mentionsAuth: /sign in|signed out|session|unauthor|expired|log in/i.test(body),
        dialogStillOpen: Array.from(document.querySelectorAll('[role="dialog"]'))
          .some((d) => d.getClientRects().length > 0),
      };
    });
    // `raised` is every toast that mounted since before the click, including any that
    // has already dismissed itself.
    said.toasts = raised;
    const url = page.url();
    console.log(`   toasts raised (recorded from before the click): ${JSON.stringify(said.toasts)}`);
    console.log(`   still on screen at +6s: ${JSON.stringify(said.onScreenNow)}`);
    console.log(`   url: ${url.replace('http://localhost:3000', '')}  dialog still open: ${said.dialogStillOpen}`);
    rec(said.toasts.length > 0 || said.mentionsAuth || /\/login/.test(url) || said.dialogStillOpen,
      'the failure is visible: a message, a trip to sign in, or the dialog held open',
      `toasts=${JSON.stringify(said.toasts)} url=${url} dialogOpen=${said.dialogStillOpen} — closing silently would lose the work without saying so`);
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

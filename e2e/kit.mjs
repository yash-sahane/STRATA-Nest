// Shared harness for the deep-testing agents.
//
// Every agent runs against the SAME live stack, so the two things that ruin a
// parallel run are (a) fighting over the same rows and (b) re-authenticating
// until the login limiter refuses. This module solves both: provision() hands
// each agent its own workspace, and sessions come from one on-disk cache.
// A bare specifier now this lives in the repo: it resolves through the workspace's
// node_modules, so the suite no longer carries one developer's absolute path.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { getJar, getBrowserCookies, getSession, renewJar, freshBrowserCookies } from './session-cache.mjs';

export const API = 'http://localhost:8000/api/v1';
export const BASE = 'http://localhost:3000';
// Resolved from this module, not from where node happens to be invoked, so the suite
// runs the same from the repo root, from e2e/, or from CI.
export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

export { getJar, getBrowserCookies, getSession, chromium };

/** One HTTP call with a cookie jar. Returns {s: status, j: parsed, t: raw}. */
export async function api(jar, method, path, body) {
  const send = async () => {
    const h = {};
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const c = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) h.Cookie = c;
    const r = await fetch(API + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch {}
    return { s: r.status, j, t, retryAfter: r.headers.get('retry-after') };
  };

  /**
   * Wait out a rate limiter rather than spending against it.
   *
   * `THROTTLE_DEFAULT_LIMIT` is 120 per 60s and the whole suite shares one budget, so a
   * long run crosses it — and every further call made the next script's window worse.
   * Hammering also manufactured failures that were not the app's: a 429'd team page shows
   * a correct "we couldn't load this" state, which a check looking for a filter reads as
   * a missing control.
   *
   * `Retry-After` is honoured when present; otherwise a short escalating wait. Bounded and
   * announced, so a stuck limiter is a visible delay rather than a silent hang.
   */
  const waitOutLimiter = async (r, attempt) => {
    const header = Number(r.retryAfter);
    const seconds = Number.isFinite(header) && header > 0 ? Math.min(header, 30) : 5 * (attempt + 1);
    console.log(`   [kit] 429 on ${method} ${path} — waiting ${seconds}s for the limiter`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  };

  let res = await send();
  for (let attempt = 0; attempt < 4 && res.s === 429; attempt += 1) {
    await waitOutLimiter(res, attempt);
    res = await send();
  }
  /**
   * One transparent re-authentication on a 401.
   *
   * The access cookie lives 900s, and a script that takes its session at the top and
   * then runs for minutes has it expire mid-run — api-validation makes ~44
   * assertions. In the whole-suite run that read "4/44 passed, 40 FAILED" with every
   * failure saying `401 Unauthorized`, which is indistinguishable from forty
   * regressions until you look.
   *
   * Retried ONCE only, and only for a 401: a genuine authorisation failure (403) or a
   * real 401 from a deliberately-unauthenticated probe must still surface, and
   * retrying forever would turn a broken session into a hang.
   */
  if (res.s === 401) {
    const renewed = await renewJar(jar);
    if (renewed) res = await send();
  }
  return res;
}

/** The platform admin, cached across agents. */
export const adminJar = () => getJar('admin@strata.local');

/** The caller's own user id (auth/me nests it under `user`). */
export async function whoami(jar) {
  const me = (await api(jar, 'GET', '/auth/me')).j;
  return me?.user?.id ?? me?.id;
}

/**
 * A private workspace + project for one agent, so nothing it creates can be
 * seen or clobbered by an agent testing something else. Returns a `cleanup()`
 * that removes everything it made.
 */
export async function provision(label) {
  const admin = await adminJar();
  const ws = (await api(admin, 'POST', '/workspaces', {
    name: `QA ${label}`,
    description: `deep-test scope for ${label}`,
  })).j?.id;
  if (!ws) throw new Error(`could not create a workspace for ${label}`);
  const project = (await api(admin, 'POST', '/projects', {
    workspaceId: ws,
    name: `${label} Project`,
    shortCode: label.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'QAP',
    clientName: 'QA Client',
  })).j?.id;
  return {
    ws,
    project,
    admin,
    cleanup: async () => { await api(admin, 'DELETE', `/workspaces/${ws}?cascade=true`); },
  };
}

/**
 * Create a sprint — and start it, when the body asks for `status: 'ACTIVE'`.
 *
 * Since 2026-11-06 the API creates sprints in PLANNING only: one created straight
 * into ACTIVE skipped everything starting a sprint does (its Backlog tasks moving
 * to To Do, the one-running-sprint-per-project rule, the start notices). So an
 * active sprint is created and then started, the way the app does it. Answers like
 * api() — `{ s, j, t }` — reported as the create it stands in for: the create's
 * status with the started sprint, or the start's own refusal.
 */
export async function createSprint(jar, body) {
  const { status, ...fields } = body;
  const created = await api(jar, 'POST', '/sprints', fields);
  if (status !== 'ACTIVE' || created.s >= 400 || !created.j?.id) return created;
  const started = await api(jar, 'PATCH', `/sprints/${created.j.id}`, { status: 'ACTIVE' });
  return started.s >= 400 ? started : { ...started, s: created.s };
}

/** Add one of the seeded role accounts to a workspace at the given role. */
export async function addRole(ws, role, email) {
  const admin = await adminJar();
  const code = (await api(admin, 'POST', '/invite_codes', { workspaceId: ws, role, maxUses: 5 })).j?.code;
  const jar = await getJar(email);
  await api(jar, 'POST', '/workspaces/accept-invitation', { code });
  return jar;
}

/**
 * Give an account notifications to act on. Returns how many were created.
 *
 * An empty notifications panel has no controls in it — nothing to tab to, nothing to
 * delete — so a check that drives the panel needs rows to exist. Two scripts used to
 * rely on whatever the admin account "happened to be holding", which was true only of a
 * database that had been clicked around in for weeks. On a freshly reset one the panel
 * was empty and they failed on their fixture, not on the application.
 *
 * The first row has somewhere to go, so it offers "Open: …"; the rest do not, and offer
 * "Mark as read: …". Both kinds of row action are therefore present.
 */
export async function seedNotifications(ws, userId, count = 3) {
  const admin = await adminJar();
  let made = 0;
  for (let i = 0; i < count; i += 1) {
    const routed = i === 0;
    const r = await api(admin, 'POST', '/notifications', {
      workspaceId: ws,
      userId,
      type: routed ? 'workspace_member_added' : 'general',
      title: `Seeded notification ${i + 1}`,
      message: 'created by the e2e kit so the panel has rows to act on',
      ...(routed ? { relatedEntityType: 'workspace', relatedEntityId: ws } : {}),
    });
    if (r.s === 201) made += 1;
  }
  return made;
}

/**
 * A signed-in page. Cookies are injected rather than typed into the login form
 * — the form is exercised deliberately by the onboarding agent, and every other
 * agent driving it would just burn the login quota.
 */
export async function signedInPage(browser, email, workspaceId, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 950 },
    ...(opts.contextOptions ?? {}),
  });
  // `fresh: true` mints a new session instead of reusing the cached one. Needed only by
  // tests that drive the REFRESH path: refresh tokens rotate and the old jti is revoked,
  // so a cached jar's refresh cookie may already be spent even though its access cookie
  // still passes /auth/me.
  await ctx.addCookies(opts.fresh
    ? await freshBrowserCookies(email)
    : await getBrowserCookies(email));
  const page = await ctx.newPage();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => {
    const t = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(t)) failedRequests.push(`${t} ${r.url().slice(0, 120)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) failedRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (workspaceId) {
    await page.evaluate((id) => { try { localStorage.setItem('currentWorkspaceId', id); } catch {} }, workspaceId);
  }
  return { ctx, page, errors, consoleErrors, failedRequests };
}

/** Go to a route and wait for it to settle. */
/**
 * Transport-level failures worth retrying. Deliberately narrow.
 *
 * The host suspends network IO under power management, which kills a navigation with
 * ERR_NETWORK_IO_SUSPENDED and took down two full check runs at random points. An
 * unretried suspend turns a 20-minute suite into a crash that reads like an app failure.
 *
 * An APPLICATION failure -- a 500, a render error, a redirect to login -- produces none of
 * these and is still surfaced on the first attempt. Retrying broadly would hide the very
 * failures these checks exist to find.
 */
const TRANSIENT_NAV = /ERR_NETWORK_IO_SUSPENDED|ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_SOCKET_NOT_CONNECTED|ERR_INTERNET_DISCONNECTED/;

export async function visit(page, route, settleMs = 2500) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(settleMs);
      return;
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_NAV.test(String(error?.message ?? ''))) throw error;
      // Give the interface time to come back before trying again.
      const backoff = 1500 * (attempt + 1);
      console.log(`   [kit] transient navigation failure on ${route} (${String(error.message).split('\n')[0].slice(0, 60)}) — retrying in ${backoff}ms`);
      await page.waitForTimeout(backoff);
    }
  }
  throw lastError;
}

/** Toasts auto-dismiss; record them from the moment they mount. */
export async function watchToasts(page) {
  await page.evaluate(() => {
    if (window.__toasts) return;
    window.__toasts = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const el = n.matches?.('[data-sonner-toast]') ? n : n.querySelector?.('[data-sonner-toast]');
        if (el) window.__toasts.push((el.textContent || '').slice(0, 200));
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
export const toasts = (page) => page.evaluate(() => window.__toasts ?? []).catch(() => []);

/** Simple pass/fail recorder. */
export function recorder() {
  const rows = [];
  const rec = (ok, name, detail = '') => {
    rows.push({ ok, name, detail: String(detail).slice(0, 400) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 300)}`);
  };
  const summary = () => {
    const bad = rows.filter((r) => !r.ok);
    console.log(`\n===== total ${rows.length}  passed ${rows.length - bad.length}  failed ${bad.length}`);
    bad.forEach((r) => console.log('  FAILED: ' + r.name + ' :: ' + r.detail));
    return rows;
  };
  return { rec, summary, rows };
}

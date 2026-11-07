// Two answers that said the wrong thing.
//
//  - A task moved to Review by a commit ("fixes #ID") left nothing in the audit
//    trail: a card changed column and the trail could not say why or by whom.
//    Each move is a `task.moved_by_commit` row now, credited to the workspace
//    member whose address the commit carries — or, for a contributor with no
//    account here, to nobody, under the name the commit gave. /activity shows
//    it, with the commit.
//  - A wrong password was answered 400 "ValidationError": the request was fine,
//    the credentials in it were not. It is a 401 AuthenticationFailed, the same
//    for every way of being wrong, and the sign-in page still says so beside the
//    form — without trying to renew a session that was never there.
//
//  And a push to an ARCHIVED project moves none of its tasks: archived is
//  read-only, and the worker checks for itself.
//
//  API, real signed push webhooks through the worker, and a look at /activity
//  and /login.
import { createHmac } from 'node:crypto';
import { api, provision, addRole, whoami, recorder, signedInPage, visit, chromium, API, BASE } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const p = await provision('commit trail');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

const run = Date.now().toString(16);
// The commit number first, so each commit's short (7-character) id is its own.
const sha = (n) => `${n}${run}0aa11bb22cc33dd44ee55ff66778899aabbccdd`.slice(0, 40);

// ---- a project connected to a repository ----------------------------------------------
console.log('===== a project whose repository moves its tasks');
const newTask = async (hierarchyId, title) =>
  (await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId, title, status: 'TODO', priority: 'MEDIUM',
  })).j;
const byMember = await newTask('CTR-T-01', 'Card form');
const byOutsider = await newTask('CTR-T-02', 'Receipt layout');
const whileArchived = await newTask('CTR-T-03', 'Refund screen');

const integration = await api(mgr, 'POST', '/github_integrations', {
  workspaceId: p.ws, projectId: p.project, repoOwner: 'acme', repoName: 'shop',
  accessToken: 'ghp_not_a_real_token_for_the_test', autoUpdateStatus: true,
});
const secret = (await api(mgr, 'POST', `/github_integrations/${integration.j?.id}/webhook-secret`, {})).j?.webhookSecret;
rec(Boolean(byMember?.id && byOutsider?.id && whileArchived?.id && secret),
  'three tasks, and a repository connected with status updates on', brief(integration));

/** A signed GitHub push of one commit. */
const push = async (commit) => {
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    commits: [{ timestamp: new Date().toISOString(), url: `https://github.com/acme/shop/commit/${commit.id}`, ...commit }],
  });
  const r = await fetch(`${API}/integrations/github/webhook/${p.project}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': `e2e-${commit.id}`,
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret ?? '').update(body).digest('hex'),
    },
    body,
  });
  return r.status;
};
const statusOf = async (task) => (await api(mgr, 'GET', `/tasks/${task.id}`)).j?.status;
const untilReview = async (task, ms = 20000) => {
  for (let waited = 0; waited < ms; waited += 500) {
    if ((await statusOf(task)) === 'REVIEW') return true;
    await sleep(500);
  }
  return false;
};
/** The trail's row for a task a commit moved; written just after the move, so asked until there. */
const trailRow = async (task, ms = 12000) => {
  for (let waited = 0; waited <= ms; waited += 500) {
    const rows = list((await api(mgr, 'GET',
      `/activity_logs?workspaceId=${p.ws}&action=task.moved_by_commit&entityId=${task.id}`)).j);
    if (rows.length) return rows;
    await sleep(500);
  }
  return [];
};

// ---- a commit by a member ------------------------------------------------------------------
console.log('===== a commit written by a member of the workspace');
{
  const pushed = await push({
    id: sha(1),
    message: 'Validate the card number. fixes #CTR-T-01',
    // As a git client might write it: capitals and all.
    author: { name: 'Role Developer', email: 'Role.Software_Developer@STRATA.local' },
  });
  rec(pushed === 202, 'the provider delivers the push', `status ${pushed}`);
  rec(await untilReview(byMember), 'the worker moves the task to Review');
  const rows = await trailRow(byMember);
  const row = rows[0];
  rec(rows.length === 1, 'and the audit trail has one row for the move', JSON.stringify(rows).slice(0, 300));
  rec(row?.userId === devId,
    'credited to the member whose address the commit carries, whatever its capitals',
    `userId=${row?.userId} expected ${devId}`);
  rec(JSON.stringify(row?.changes?.status) === JSON.stringify(['TODO', 'REVIEW']),
    'saying where the task was and where it went', JSON.stringify(row?.changes));
  rec(row?.metadata?.commitSha === sha(1) && row?.metadata?.label === 'Card form',
    'and which commit, and which task', JSON.stringify(row?.metadata));
}

// ---- a commit by somebody with no account here --------------------------------------------
console.log('===== a commit by an outside contributor');
{
  const pushed = await push({
    id: sha(2),
    message: 'Tidy the receipt. Fixes #CTR-T-02',
    author: { name: 'Outside Contributor', email: 'someone@elsewhere.test' },
  });
  rec(pushed === 202, 'the provider delivers the push', `status ${pushed}`);
  rec(await untilReview(byOutsider), 'the worker moves that task to Review too');
  const [row] = await trailRow(byOutsider);
  rec(Boolean(row) && row.userId === '',
    'the row credits nobody: no member has that address', JSON.stringify(row ?? null).slice(0, 300));
  rec(row?.metadata?.commitAuthor === 'Outside Contributor',
    'but keeps the name the commit gave', JSON.stringify(row?.metadata));
}

// ---- the activity page --------------------------------------------------------------------
console.log('===== what /activity shows');
const browser = await chromium.launch();
{
  const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/activity', 4000);
  const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec(/moved to review by commit/i.test(text), 'the move reads as a move a commit made', text.slice(0, 300));
  rec(text.includes(sha(1).slice(0, 7)) && text.includes(sha(2).slice(0, 7)),
    'each row names its commit by the short id people quote', text.slice(0, 300));
  rec(text.includes('Outside Contributor'),
    'and the outsider by the name their commit gave, not "Someone"', text.slice(0, 300));
  rec(errors.length === 0, 'without a page error', errors.join(' | '));
  await ctx.close();
}

// ---- an archived project ------------------------------------------------------------------
console.log('===== a push to an archived project');
{
  const archived = await api(mgr, 'PATCH', `/projects/${p.project}`, { status: 'ARCHIVED' });
  rec(archived.s === 200, 'the project is archived', brief(archived));
  // Whether the API takes the delivery or refuses it, nothing of the project's may change.
  const pushed = await push({
    id: sha(3),
    message: 'Wire the refund button. fixes #CTR-T-03',
    author: { name: 'Role Developer', email: 'role.software_developer@strata.local' },
  });
  await sleep(6000);
  rec((await statusOf(whileArchived)) === 'TODO', 'its task stays where it was', `push ${pushed}`);
  rec((await trailRow(whileArchived, 1500)).length === 0, 'and the trail records no move that did not happen');
  await api(mgr, 'PATCH', `/projects/${p.project}`, { status: 'ACTIVE' });
}

// ---- a wrong password ---------------------------------------------------------------------
console.log('===== a wrong password, and an address with no account');
{
  // Each from an address of its own, so the per-address sign-in limit — shared
  // by every script on this host — does not stand in for the answer under test.
  const from = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  const signIn = async (email, password) => {
    for (let tries = 0; tries < 6; tries += 1) {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': from() },
        body: JSON.stringify({ email, password }),
      });
      const t = await r.text();
      if (r.status !== 429) {
        let j = null;
        try { j = JSON.parse(t); } catch {}
        return { s: r.status, j, t, cookies: r.headers.getSetCookie?.() ?? [] };
      }
      await sleep(13000);
    }
    return { s: 429, j: null, t: 'still limited', cookies: [] };
  };
  const wrong = await signIn('role.tester@strata.local', 'Wrong-Password-1');
  const nobody = await signIn(`e2e.nobody.${run}@strata.local`, 'Wrong-Password-1');
  rec(wrong.s === 401, 'a wrong password is a 401, not a 400', brief(wrong));
  rec(wrong.j?.error?.type === 'AuthenticationFailed'
      && JSON.stringify(wrong.j?.error?.message) === JSON.stringify(['Invalid email or password']),
    'typed AuthenticationFailed, with the same message as before', wrong.t.slice(0, 200));
  rec(nobody.s === wrong.s && JSON.stringify(nobody.j?.error) === JSON.stringify(wrong.j?.error),
    'an address with no account gets exactly the same answer', `${nobody.t.slice(0, 160)} vs ${wrong.t.slice(0, 160)}`);
  rec(wrong.cookies.length === 0 && nobody.cookies.length === 0, 'and neither starts a session',
    JSON.stringify([wrong.cookies.length, nobody.cookies.length]));
}

// ---- the sign-in page ---------------------------------------------------------------------
console.log('===== the sign-in page, given a wrong password');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const refreshes = [];
  page.on('request', (r) => { if (/\/auth\/refresh\/?$/.test(new URL(r.url()).pathname)) refreshes.push(r.url()); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // The form's own alert: Next's route announcer is a role="alert" too.
  const alert = page.locator('form [role="alert"]');
  let said = '';
  // The browser signs in from this host's own address, whose per-address limit
  // every script shares: a "too many attempts from this device" is that limit,
  // not the answer under test, so it is waited out once.
  for (let tries = 0; tries < 2; tries += 1) {
    await page.locator('#email').fill('role.tester@strata.local');
    await page.locator('#password').fill('Wrong-Password-2');
    await page.getByRole('button', { name: 'Sign In' }).click();
    said = await alert.first().waitFor({ state: 'visible', timeout: 10000 })
      .then(() => alert.first().innerText(), () => '');
    if (!/too many sign-in attempts from this device/i.test(said)) break;
    console.log('   the per-address sign-in limit answered — waiting out its minute');
    await sleep(62000);
  }
  rec(/invalid email or password/i.test(said), 'the form says "Invalid email or password" beside itself', said);
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec(!/session has ended/i.test(body), 'not "your session has ended": there was no session', body.slice(0, 200));
  rec(new URL(page.url()).pathname === '/login', 'and stays on the sign-in page', page.url());
  rec(refreshes.length === 0, 'without trying to renew a session that was never there', refreshes.join(' '));
  await ctx.close();
}
await browser.close();

await p.cleanup();
summary();

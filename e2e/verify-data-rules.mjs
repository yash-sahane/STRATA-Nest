// Values the screens can show, one way to archive, and nothing a browser can
// no longer reach.
//
//  - a functional requirement is created with ITS statuses (REVIEW, DEPLOYED),
//    not a client requirement's (SUBMITTED, ARCHIVED); it always has a priority,
//    and a priority is one of the four;
//  - a project's status is one of the five; Archived is how a project is
//    archived, and there is no second, `archived` flag;
//  - the project list keeps archived projects out of "All but archived", says
//    how many there are and shows them on request; pickers stop offering them;
//  - the routes a browser no longer uses are gone: the mail-anything endpoint and
//    the two web-app proxies (bulk-save, send-notification-email); a leave balance
//    changes only through `adjust`, and commits only arrive from the webhook;
//  - a project carries no settings, member list, colour or logo that nothing
//    reads, and copying one offers no "Project Settings" that change nothing;
//  - whoever may delete tasks takes down somebody else's comment, and its author is
//    told; nobody else may, and nobody but the author edits it.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder, API, BASE } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t ?? JSON.stringify(r.j)).slice(0, 200)}`;

const browser = await chromium.launch();
const p = await provision('rules');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const devId = await whoami(dev);

// ---- functional requirements ------------------------------------------------------------
console.log('===== a functional requirement takes its own values');
const fr = (status, extra = {}) => api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, title: `Status ${status ?? 'none'}`, complexity: 'LOW', type: 'FUNCTIONAL',
  ...(status ? { status } : {}), ...extra,
});
for (const status of ['DRAFT', 'REVIEW', 'DEPLOYED']) {
  const r = await fr(status, { priority: 'LOW' });
  rec(r.s === 201 && r.j?.status === status, `created as ${status}, one of its statuses`, brief(r));
}
for (const status of ['SUBMITTED', 'ARCHIVED']) {
  const r = await fr(status, { priority: 'LOW' });
  rec(r.s === 400, `refused as ${status}, a client requirement's status`, brief(r));
}
const plain = await fr(undefined);
rec(plain.s === 201 && plain.j?.priority === 'MEDIUM', 'created without a priority, it has Medium — as its form shows', brief(plain));
const banana = await api(mgr, 'PATCH', `/functional_requirements/${plain.j?.id}`, { priority: 'banana' });
rec(banana.s === 400, 'a priority that is not one of the four is refused', brief(banana));
const high = await api(mgr, 'PATCH', `/functional_requirements/${plain.j?.id}`, { priority: 'HIGH' });
rec(high.s === 200 && high.j?.priority === 'HIGH', 'and one that is is kept', brief(high));

// ---- projects ---------------------------------------------------------------------------
console.log('===== a project is archived by its status');
const bogus = await api(mgr, 'PATCH', `/projects/${p.project}`, { status: 'banana' });
rec(bogus.s === 400, 'a project status that is not one of the five is refused', brief(bogus));
const keep = (await api(p.admin, 'POST', '/projects', { workspaceId: p.ws, name: 'Still running', shortCode: 'RUNS', clientName: 'QA' })).j ?? {};
const old = (await api(p.admin, 'POST', '/projects', { workspaceId: p.ws, name: 'Finished long ago', shortCode: 'OLDP', clientName: 'QA' })).j ?? {};
const archived = await api(mgr, 'PATCH', `/projects/${old.id}`, { status: 'ARCHIVED' });
rec(archived.s === 200 && archived.j?.status === 'ARCHIVED' && !('archived' in (archived.j ?? {})),
  'Archived is a status, and there is no second archived flag', brief(archived));

{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/projects', 6000);
  const listed = async (name) => page.locator('main').getByText(name, { exact: true }).count();
  rec(await listed('Still running') > 0 && await listed('Finished long ago') === 0,
    'the list keeps an archived project out of "All but archived"',
    JSON.stringify({ running: await listed('Still running'), archived: await listed('Finished long ago') }));
  const hint = page.getByText(/1 archived project is not listed/);
  rec(await hint.count() === 1, 'and says one is not listed', `hints: ${await hint.count()}`);
  await page.getByRole('button', { name: 'Show it' }).click().catch(() => {});
  await page.waitForTimeout(800);
  rec(await listed('Finished long ago') > 0, 'showing it on request', `listed: ${await listed('Finished long ago')}`);

  await visit(page, `/tasks?projectId=${keep.id}&scope=all`, 6000);
  await page.getByRole('combobox', { name: 'Select a project' }).first().click().catch(() => {});
  const options = await page.getByRole('option').allInnerTexts();
  rec(options.some((t) => t.includes('Still running')) && !options.some((t) => t.includes('Finished long ago')),
    'a project picker no longer offers it for new work', JSON.stringify(options));
  await page.keyboard.press('Escape');
  await visit(page, `/tasks?projectId=${old.id}&scope=all`, 6000);
  const trigger = await page.getByRole('combobox', { name: 'Select a project' }).first().innerText().catch(() => '');
  rec(/Finished long ago/.test(trigger) && /Archived/.test(trigger), 'but a link to it still opens it, saying it is archived', JSON.stringify(trigger));
  await ctx.close();
}

// ---- what a browser no longer reaches -----------------------------------------------------
console.log('===== routes nothing uses are gone');
const mailAnything = await api(mgr, 'POST', '/email/send-notification', { to: ['role.manager@strata.local'], subject: 'x', html: 'x' });
rec(mailAnything.s === 404, 'the API no longer mails a caller-written message', brief(mailAnything));
for (const route of ['/api/bulk-save', '/api/send-notification-email']) {
  const r = await fetch(`${BASE}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' });
  rec(r.status === 404, `the web app has no ${route} proxy any more`, String(r.status));
}
{
  const balance = await api(mgr, 'POST', '/leave_balances/adjust', { workspaceId: p.ws, userId: devId, year: new Date().getFullYear(), paidLeave: 12 });
  rec(balance.s === 200, 'a balance is set through adjust', brief(balance));
  const patched = await api(mgr, 'PATCH', `/leave_balances/${balance.j?.id}`, { paidLeave: 99 });
  const created = await api(mgr, 'POST', '/leave_balances', { workspaceId: p.ws, userId: devId, year: 2031, paidLeave: 99 });
  const removed = await api(mgr, 'DELETE', `/leave_balances/${balance.j?.id}`);
  rec([patched, created, removed].every((r) => r.s === 404), 'and through nothing else — no second door without its rules or its notice',
    [patched, created, removed].map(brief).join(' | '));
  const commit = await api(mgr, 'POST', '/git_commits', {
    projectId: p.project, provider: 'github', commitSha: 'abc123', message: 'Fixes everything', author: 'Nobody',
    authorEmail: 'nobody@example.invalid', timestamp: new Date().toISOString(), url: 'https://example.invalid/c/abc123',
  });
  rec(commit.s === 404, 'commits cannot be written through the API — they come from the webhook', brief(commit));
}

// ---- settings nothing reads -------------------------------------------------------------
console.log('===== no settings that change nothing');
rec(['settings', 'memberIds', 'methodology', 'logo', 'color'].every((k) => !(k in (keep ?? {}))),
  'a project carries no settings, member list, methodology, logo or colour that nothing reads', JSON.stringify(Object.keys(keep ?? {})));
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/projects', 6000);
  const card = page.locator('main').getByText('Still running', { exact: true }).first();
  const menu = page.getByRole('button', { name: /Actions for Still running|More actions|Project actions/ }).first();
  if (await menu.count()) await menu.click(); else await card.hover();
  await page.getByRole('menuitem', { name: /Clone|Copy/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const dialog = page.getByRole('dialog');
  const options = await dialog.locator('label, legend').allInnerTexts().catch(() => []);
  rec(options.length > 0 && !options.some((t) => /Project Settings/.test(t)),
    'copying a project offers no "Project Settings" option', JSON.stringify(options.slice(0, 8)));
  await ctx.close();
}

// ---- comments ---------------------------------------------------------------------------
console.log('===== a comment can be taken down, and its author is told');
{
  const task = (await api(mgr, 'POST', '/tasks', { workspaceId: p.ws, projectId: p.project, title: 'Discuss the release', status: 'TODO', priority: 'LOW' })).j ?? {};
  const said = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: 'Something that should not stay up' });
  const byOther = await api(tester, 'DELETE', `/task_comments/${said.j?.id}`);
  rec(byOther.s === 403, 'another member cannot delete it', brief(byOther));
  const rewrite = await api(mgr, 'PATCH', `/task_comments/${said.j?.id}`, { content: 'Words put in their mouth' });
  rec(rewrite.s === 403, 'nobody but its author edits it, a manager neither', brief(rewrite));
  const takenDown = await api(mgr, 'DELETE', `/task_comments/${said.j?.id}`);
  rec(takenDown.s === 204, 'whoever may delete tasks takes it down', brief(takenDown));
  let told = null;
  for (let i = 0; i < 10 && !told; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const inbox = await api(dev, 'GET', `/notifications?workspaceId=${p.ws}&userId=${devId}&ordering=-createdAt`);
    told = (inbox.j?.items ?? []).find((n) => n.type === 'TASK_COMMENT_REMOVED') ?? null;
  }
  rec(Boolean(told) && /removed your comment/.test(told?.message ?? ''), 'and its author is told who removed it', JSON.stringify(told?.message ?? null));
}

await browser.close();
await p.cleanup();
summary();

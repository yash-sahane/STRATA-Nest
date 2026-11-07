// A file is attached where the work is: to a task or a client requirement.
//
//  - the API attaches a file to a task or a client requirement of the workspace and
//    files it in that record's project; it refuses a record from another workspace, a
//    project that is not the record's, and both at once; a read-only member cannot;
//  - a task's attachments are listed by task, a requirement's by requirement;
//  - deleting the task or the requirement hands its files back to the project;
//  - the task dialog has Attachments: a tester attaches a log through it, and every
//    file has View (when a browser can show it) and Download; a read-only member sees
//    the files and no Attach button;
//  - the client requirement dialog has Attachments too;
//  - the project's Files tab lists every file and says, with a link, what it is on;
//  - tasks, comments and client requirements no longer carry an `attachments` list.
import { chromium, api, provision, addRole, signedInPage, visit, recorder, API } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t ?? JSON.stringify(r.j)).slice(0, 200)}`;
const cookie = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
// A 1x1 PNG: something a browser shows inline, so the row offers View.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(jar, fields, name = 'screenshot.png', bytes = PNG, type = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: cookie(jar) }, body: form });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch {}
  return { s: r.status, j, t };
}

const browser = await chromium.launch();
const p = await provision('attach');
const other = await provision('attach-elsewhere');
const P = p.project;
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const member = await addRole(p.ws, 'MEMBER', 'role.member@strata.local');

const make = async (label, path, body, jar = mgr) => {
  const r = await api(jar, 'POST', path, { workspaceId: p.ws, projectId: P, ...body });
  if (r.s !== 201) console.log(`   could not create ${label}: ${brief(r)}`);
  return r.j ?? {};
};
const task = await make('task', '/tasks', { title: 'Checkout button does nothing', status: 'TODO', priority: 'HIGH' });
const cr = await make('client requirement', '/client_requirements', {
  title: 'Shoppers can pay by card', description: '', clientName: 'QA Client', priority: 'HIGH', status: 'APPROVED',
});
const second = (await api(p.admin, 'POST', '/projects', { workspaceId: p.ws, name: 'Second project', shortCode: 'SECO', clientName: 'QA Client' })).j ?? {};
const foreign = (await api(other.admin, 'POST', '/tasks', {
  workspaceId: other.ws, projectId: other.project, title: 'Somebody else\'s task', status: 'TODO', priority: 'LOW',
})).j ?? {};
rec([task, cr, second, foreign].every((row) => row.id), 'a task, a client requirement, a second project and a task elsewhere exist');

// ---- the API ---------------------------------------------------------------------------
console.log('===== attaching, through the API');
const shot = await upload(tester, { workspaceId: p.ws, taskId: task.id });
rec(shot.s === 201 && shot.j?.taskId === task.id && shot.j?.projectId === P && shot.j?.clientRequirementId === '',
  'a tester attaches a screenshot to a task, and it goes in the task\'s project', brief(shot));
const elsewhere = await upload(tester, { workspaceId: p.ws, taskId: foreign.id });
rec(elsewhere.s === 400 && /not found in this workspace/.test(elsewhere.t),
  'a task from another workspace is refused, as if it did not exist', brief(elsewhere));
const mismatched = await upload(tester, { workspaceId: p.ws, projectId: second.id, taskId: task.id });
rec(mismatched.s === 400 && /different project/.test(mismatched.t), 'so is a project that is not the task\'s', brief(mismatched));
const both = await upload(tester, { workspaceId: p.ws, taskId: task.id, clientRequirementId: cr.id });
rec(both.s === 400, 'and a file on a task and a requirement at once', brief(both));
const observer = await upload(member, { workspaceId: p.ws, taskId: task.id });
rec(observer.s === 403, 'a read-only member cannot attach', brief(observer));
const brief_ = await upload(mgr, { workspaceId: p.ws, clientRequirementId: cr.id }, 'brief.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'), 'application/pdf');
rec(brief_.s === 201 && brief_.j?.clientRequirementId === cr.id && brief_.j?.projectId === P,
  'a manager attaches the client\'s brief to its requirement', brief(brief_));
const own = await upload(mgr, { workspaceId: p.ws, projectId: P }, 'plan.txt', Buffer.from('the plan\n'), 'text/plain');
rec(own.s === 201 && own.j?.taskId === '' && own.j?.clientRequirementId === '', 'and a file of the project\'s own is on neither', brief(own));

const onTask = await api(member, 'GET', `/files?workspaceId=${p.ws}&taskId=${task.id}`);
const onTaskNames = (onTask.j?.items ?? []).map((f) => f.name);
rec(onTask.s === 200 && onTaskNames.length === 1 && onTaskNames[0] === 'screenshot.png',
  'the task\'s attachments are listed by task — to a read-only member too', `${onTask.s} ${JSON.stringify(onTaskNames)}`);

const taskRow = await api(mgr, 'GET', `/tasks/${task.id}`);
const crRow = await api(mgr, 'GET', `/client_requirements/${cr.id}`);
const comment = await api(tester, 'POST', '/task_comments', { taskId: task.id, content: 'Screenshot attached.' });
rec([taskRow, crRow, comment].every((r) => r.j && !('attachments' in r.j)),
  'tasks, comments and client requirements no longer carry an attachments list of their own',
  JSON.stringify([taskRow, crRow, comment].map((r) => r.j && Object.keys(r.j).includes('attachments'))));

// ---- the task dialog -------------------------------------------------------------------
console.log('===== the task dialog');
{
  const { ctx, page } = await signedInPage(browser, 'role.tester@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${P}&taskId=${task.id}&scope=all`, 7000);
  const dialog = page.getByRole('dialog');
  const heading = dialog.getByRole('heading', { name: /^Attachments/ });
  rec(await heading.count() === 1, 'the task dialog has an Attachments section', `headings: ${await heading.count()}`);
  const row = dialog.locator('li').filter({ hasText: 'screenshot.png' });
  rec(await row.count() === 1, 'listing the screenshot', `rows: ${await row.count()}`);
  const view = await row.getByRole('link', { name: 'View' }).getAttribute('href').catch(() => null);
  const download = await row.getByRole('link', { name: 'Download' }).getAttribute('href').catch(() => null);
  rec(/\/files\/[^/]+\/view\/$/.test(view ?? '') && /\/files\/[^/]+\/download\/$/.test(download ?? ''),
    'with View and Download', JSON.stringify({ view, download }));
  const shown = await page.request.get(view ?? 'about:blank').catch(() => null);
  rec(shown?.status() === 200, 'and View opens it', String(shown?.status()));

  const attach = dialog.getByRole('button', { name: 'Attach files' });
  rec(await attach.count() === 1, 'a tester is offered Attach files', `buttons: ${await attach.count()}`);
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'console.log', mimeType: 'text/plain', buffer: Buffer.from('TypeError: x is undefined\n') });
  const added = dialog.locator('li').filter({ hasText: 'console.log' });
  await added.first().waitFor({ timeout: 10000 }).catch(() => {});
  rec(await added.count() === 1, 'attaching a log through the dialog lists it there', `rows: ${await added.count()}`);
  const listed = await api(mgr, 'GET', `/files?workspaceId=${p.ws}&taskId=${task.id}`);
  rec((listed.j?.items ?? []).some((f) => f.name === 'console.log'),
    'and the server has it on the task', brief(listed));
  await ctx.close();
}
{
  const { ctx, page } = await signedInPage(browser, 'role.member@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${P}&taskId=${task.id}&scope=all`, 7000);
  const dialog = page.getByRole('dialog');
  const rows = await dialog.locator('li').filter({ hasText: /screenshot\.png|console\.log/ }).count();
  const attach = await dialog.getByRole('button', { name: 'Attach files' }).count();
  const remove = await dialog.getByRole('button', { name: /^Delete screenshot\.png/ }).count();
  rec(rows === 2 && attach === 0 && remove === 0, 'a read-only member sees the attachments, with nothing to attach or delete',
    JSON.stringify({ rows, attach, remove }));
  await ctx.close();
}

// ---- the client requirement dialog and the project's Files tab ---------------------------
console.log('===== the requirement dialog and the Files tab');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/requirements?projectId=${P}&crId=${cr.id}`, 7000);
  const dialog = page.getByRole('dialog');
  const heading = await dialog.getByRole('heading', { name: /^Attachments/ }).count();
  const row = await dialog.locator('li').filter({ hasText: 'brief.pdf' }).count();
  rec(heading === 1 && row === 1, 'the client requirement dialog lists its brief under Attachments', JSON.stringify({ heading, row }));

  await visit(page, `/projects/${P}`, 7000);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.waitForTimeout(1500);
  const panel = page.getByRole('tabpanel');
  const names = await panel.locator('li').allInnerTexts();
  rec(['screenshot.png', 'console.log', 'brief.pdf', 'plan.txt'].every((n) => names.some((t) => t.includes(n))),
    'the Files tab lists every file in the project', JSON.stringify(names.map((t) => t.split('\n')[0])));
  const onTaskLink = await panel.locator('li').filter({ hasText: 'screenshot.png' }).getByRole('link', { name: /Checkout button does nothing/ })
    .getAttribute('href').catch(() => null);
  rec(onTaskLink === `/tasks?projectId=${P}&taskId=${task.id}`, 'saying which task a file is on, as a link to it', String(onTaskLink));
  const onCrLink = await panel.locator('li').filter({ hasText: 'brief.pdf' }).getByRole('link', { name: /Shoppers can pay by card/ })
    .getAttribute('href').catch(() => null);
  rec(onCrLink === `/requirements?projectId=${P}&crId=${cr.id}`, 'and which client requirement', String(onCrLink));
  const ownLinks = await panel.locator('li').filter({ hasText: 'plan.txt' }).getByRole('link', { name: /task|requirement/i }).count();
  rec(ownLinks === 0, 'a project file of its own says it is on nothing', `links: ${ownLinks}`);
  await ctx.close();
}

// ---- deleting hands the files back -------------------------------------------------------
console.log('===== deleting the task or the requirement keeps its files');
{
  const del = await api(mgr, 'DELETE', `/tasks/${task.id}`);
  const after = await api(mgr, 'GET', `/files/${shot.j?.id}`);
  rec(del.s === 204 && after.s === 200 && after.j?.taskId === '' && after.j?.projectId === P,
    'deleting the task hands its screenshot back to the project', `${del.s} -> ${brief(after)}`);
  const delCr = await api(mgr, 'DELETE', `/client_requirements/${cr.id}`);
  const afterCr = await api(mgr, 'GET', `/files/${brief_.j?.id}`);
  rec(delCr.s === 204 && afterCr.s === 200 && afterCr.j?.clientRequirementId === '' && afterCr.j?.projectId === P,
    'and deleting the requirement hands back its brief', `${delCr.s} -> ${brief(afterCr)}`);
}

await browser.close();
await p.cleanup();
await other.cleanup();
summary();

// Who may do what to the delivery work — and the screens agree with it.
//
//  - A tester who found a defect could not file it: creating a task was a
//    manager's alone. Delivery roles now file tasks (task:create); deleting one
//    and signing it off as done stay with managers.
//  - task:update, held to work the board, let a developer move a task into
//    another sprint, epic or requirement — re-planning the running sprint.
//  - requirement:write alone planned requirements into sprints, and saved an AI
//    tree full of epics and tasks.
//  - The only approver in a workspace could never have their own hours approved
//    or their own allowance changed; and anybody could "reject" their own request.
//  - The edit dialog offered Done to people the server would refuse, and the
//    board took a drop on Done from them and threw it back.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, adminJar } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;

const browser = await chromium.launch();
const p = await provision('whodoes');
const admin = await adminJar();
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const [mgrId, testerId, devId] = await Promise.all([mgr, tester, dev].map(whoami));

const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return local(d); };
const sprintA = (await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Sprint A', startDate: day(0), endDate: day(10),
})).j;
const sprintB = (await api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Sprint B', startDate: day(11), endDate: day(20),
})).j;
const fr = (await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'WDW-FR-01', title: 'Checkout', sprintId: sprintA?.id,
})).j;

// ---- filing work --------------------------------------------------------------------
console.log('===== a tester files the defect they found');
let bug;
{
  const filed = await api(tester, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'WDW-BUG-01', title: 'Card number accepts letters',
    status: 'TODO', priority: 'HIGH', functionalRequirementId: fr?.id, labels: ['red:bug'],
  });
  bug = filed.j;
  rec(filed.s === 201, 'a tester can file a task', brief(filed));
  rec(bug?.sprintId === sprintA?.id, 'filed under a requirement, it joins that requirement\'s sprint',
    JSON.stringify({ sprint: bug?.sprintId }));
  const del = await api(tester, 'DELETE', `/tasks/${bug?.id}`);
  rec(del.s === 403, 'but cannot delete it — deleting work stays with managers', brief(del));
  for (const status of ['IN_PROGRESS', 'REVIEW']) await api(tester, 'PATCH', `/tasks/${bug?.id}`, { status });
  const done = await api(tester, 'PATCH', `/tasks/${bug?.id}`, { status: 'DONE' });
  rec(done.s === 403, 'nor sign it off as done', brief(done));
}

// ---- planning -------------------------------------------------------------------------
console.log('===== moving work between sprints is planning');
{
  const moved = await api(dev, 'PATCH', `/tasks/${bug?.id}`, { sprintId: sprintB?.id });
  rec(moved.s === 403, 'a developer cannot move a task into another sprint', brief(moved));
  const parent = await api(dev, 'PATCH', `/tasks/${bug?.id}`, { functionalRequirementId: '' });
  rec(parent.s === 403, 'nor take it out from under its requirement', brief(parent));
  const work = await api(dev, 'PATCH', `/tasks/${bug?.id}`, { title: 'Card number accepts letters and spaces' });
  rec(work.s < 300, 'while working on it is still theirs', brief(work));
  const byManager = await api(mgr, 'PATCH', `/tasks/${bug?.id}`, { sprintId: sprintB?.id });
  rec(byManager.s < 300, 'a manager can move it', brief(byManager));

  // A custom role that writes requirements and plans nothing.
  const analyst = await api(mgr, 'POST', '/workspace_roles', {
    workspaceId: p.ws, name: `Analyst ${Date.now() % 100000}`, permissions: ['requirement:write'],
  });
  const memberships = (await api(admin, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j;
  const devMember = (Array.isArray(memberships) ? memberships : memberships?.items ?? []).find((m) => m.userId === devId);
  await api(mgr, 'PATCH', `/workspace_members/${devMember?.id}`, { role: analyst.j?.name });
  const plan = await api(dev, 'PATCH', `/functional_requirements/${fr?.id}`, { sprintId: sprintB?.id });
  rec(plan.s === 403, 'a role that writes requirements but plans nothing cannot plan one into a sprint', brief(plan));
  const edit = await api(dev, 'PATCH', `/functional_requirements/${fr?.id}`, { description: 'Pay by card, validated' });
  rec(edit.s < 300, 'but can still edit the requirement itself', brief(edit));
  const tree = await api(dev, 'POST', '/bulk-save', {
    workspaceId: p.ws, projectId: p.project, projectCode: 'WDW',
    generated: { epics: [{ name: 'Generated epic' }], tasks: [{ title: 'Generated task' }] },
  });
  rec(tree.s === 403, 'nor save a generated tree of epics and tasks', brief(tree));
  await api(mgr, 'PATCH', `/workspace_members/${devMember?.id}`, { role: 'SOFTWARE_DEVELOPER' });
}

// ---- deciding one's own records ------------------------------------------------------------
console.log('===== your own hours and allowance: another approver\'s, unless there is none');
{
  const now = Date.now();
  const entry = (await api(mgr, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, description: 'Planning',
    startTime: new Date(now - 2 * 3600e3).toISOString(), endTime: new Date(now - 3600e3).toISOString(),
  })).j;
  const own = await api(mgr, 'POST', `/time_entries/${entry?.id}/approve`, {});
  rec(own.s === 403, 'a manager cannot approve their own hours while another approver exists', brief(own));
  const reject = await api(mgr, 'POST', `/time_entries/${entry?.id}/reject`, { reason: 'mine' });
  rec(reject.s === 403 && /instead of rejecting/.test(reject.t), 'nor "reject" them — they are theirs to edit', brief(reject));

  // A workspace with one approver: the platform admin who made it.
  const solo = await provision('whodoesSolo');
  const soloEntry = (await api(admin, 'POST', '/time_entries', {
    workspaceId: solo.ws, projectId: solo.project, description: 'Alone',
    startTime: new Date(now - 2 * 3600e3).toISOString(), endTime: new Date(now - 3600e3).toISOString(),
  })).j;
  const approvers = await api(admin, 'GET', `/time_entries/approvers?workspaceId=${solo.ws}`);
  rec(Array.isArray(approvers.j) && approvers.j.length === 1, 'who approves time is listed', brief(approvers));
  const soloApproved = await api(admin, 'POST', `/time_entries/${soloEntry?.id}/approve`, {});
  rec(soloApproved.s < 300, 'the only approver approves their own', brief(soloApproved));
  await solo.cleanup();

  let offset = 30;
  while ([0, 6].includes(new Date(Date.now() + offset * 864e5).getDay())) offset += 1;
  const leave = (await api(mgr, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: day(offset), endDate: day(offset), reason: 'Mine',
  })).j;
  const selfReject = await api(mgr, 'POST', `/leave_requests/${leave?.id}/reject`, { reason: 'mine' });
  rec(selfReject.s === 403 && /Withdraw/.test(selfReject.t), 'nobody rejects their own leave request; they withdraw it', brief(selfReject));
  const balance = await api(mgr, 'POST', '/leave_balances/adjust', {
    workspaceId: p.ws, userId: mgrId, year: new Date().getFullYear(), paidLeave: 99,
  });
  rec(balance.s === 403, 'nor changes their own allowance while another approver exists', brief(balance));
}

// ---- the screens -------------------------------------------------------------------------
console.log('===== the screens offer what the server allows');
{
  const { ctx, page } = await signedInPage(browser, 'role.tester@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${p.project}&scope=all`, 9000);
  rec((await page.getByRole('button', { name: /new task/i }).count()) > 0, 'a tester sees New Task');
  const doneHint = await page.getByText('Signed off by a manager').count();
  rec(doneHint > 0, 'and the board says Done is a manager\'s sign-off');
  await visit(page, `/tasks?projectId=${p.project}&taskId=${bug?.id}&edit=1`, 9000);
  const dialog = page.getByRole('dialog');
  const opened = await dialog.waitFor({ timeout: 12000 }).then(() => true, () => false);
  rec(opened, 'the edit dialog opens');
  if (opened) {
    const text = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ');
    rec(/Done is a manager.s sign-off/.test(text) || /A task is marked done from Review/.test(text),
      'the status field says why Done is not offered', text.slice(0, 300));
    rec(/Moving a task under another requirement is part of planning/.test(text),
      'and the requirement field says moving it is planning', text.slice(0, 400));
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

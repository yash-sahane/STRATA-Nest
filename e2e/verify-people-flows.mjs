// Getting people in, handing a workspace on, and letting people go — each with
// nothing left unsaid.
//
//  - The administrator who created a workspace became its owner and a Manager in
//    it for good: on its roster, asked to decide its leave, counted as "another
//    approver", and — being its owner — impossible to remove. A workspace can now
//    be created FOR somebody, and ownership can be handed on.
//  - Somebody switched off or declined saw a workspace list that hid the
//    workspace, or "awaiting a decision" for ever.
//  - Removing a member said only "cannot be undone", and left their pending leave
//    in the approvers' queue under "Unknown User" and their name on open tasks.
//  - Three places added people, each with its own features and words.
//  - The screens promised email this installation does not send.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami, getJar } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch();
const admin = await adminJar();
const adminId = await whoami(admin);

// ---- a workspace made for somebody ----------------------------------------------------
console.log('===== an administrator creates a workspace for the person who will run it');
const made = await api(admin, 'POST', '/workspaces', {
  name: `QA people ${Date.now() % 100000}`,
  description: 'deep-test scope for people',
  manager: { name: 'Role Manager', email: 'role.manager@strata.local' },
});
const wsId = made.j?.id;
const mgr = await getJar('role.manager@strata.local');
const mgrId = await whoami(mgr);
{
  rec(made.s === 201 || made.s === 200, 'the workspace is created', brief(made));
  rec(made.j?.ownerId === mgrId, 'and owned by the person it was made for, not the administrator',
    JSON.stringify({ owner: made.j?.ownerId, mgrId, adminId }));
  const members = list((await api(admin, 'GET', `/workspace_members?workspaceId=${wsId}&limit=100`)).j);
  rec(members.some((m) => m.userId === mgrId && m.role === 'MANAGER' && m.status === 'ACTIVE'),
    'who is its first Manager', JSON.stringify(members.map((m) => [m.userId === mgrId ? 'mgr' : m.userId, m.role])));
  rec(!members.some((m) => m.userId === adminId), 'and the administrator is not on its roster',
    JSON.stringify(members.map((m) => m.userId === adminId ? 'ADMIN' : m.role)));
  const fresh = await api(admin, 'POST', '/workspaces', {
    name: `QA people new ${Date.now() % 100000}`,
    description: 'deep-test scope for people new',
    manager: { name: 'Brand New Manager', email: `e2e.newmgr.${Date.now()}@strata.local` },
  });
  rec(Boolean(fresh.j?.manager?.temporaryPassword) || fresh.j?.manager?.emailSent === true,
    'a new account is made for somebody who had none — its temporary password handed back when mail cannot carry it',
    JSON.stringify(fresh.j?.manager ?? fresh.t).slice(0, 200));
  if (fresh.j?.id) await api(admin, 'DELETE', `/workspaces/${fresh.j.id}?cascade=true`);
}

console.log('===== ownership is handed on, to somebody who could run it');
{
  // Into the workspace the code way: a code the owner makes.
  const code = (await api(mgr, 'POST', '/invite_codes', { workspaceId: wsId, role: 'ASSISTANT_MANAGER', maxUses: 2 })).j?.code;
  const am = await getJar('role.assistant_manager@strata.local');
  await api(am, 'POST', '/workspaces/accept-invitation', { code });
  const amId = await whoami(am);
  const notManager = await api(mgr, 'POST', `/workspaces/${wsId}/transfer-ownership`, { userId: amId });
  rec(notManager.s === 400 && /Manager first/.test(notManager.t),
    'not to somebody whose role cannot run it — make them a Manager first', brief(notManager));
  const members = list((await api(mgr, 'GET', `/workspace_members?workspaceId=${wsId}&limit=100`)).j);
  const amMembership = members.find((m) => m.userId === amId);
  await api(mgr, 'PATCH', `/workspace_members/${amMembership?.id}`, { role: 'MANAGER' });
  const byOther = await api(am, 'POST', `/workspaces/${wsId}/transfer-ownership`, { userId: amId });
  rec(byOther.s === 403, 'nobody but the owner hands it on', brief(byOther));
  const handed = await api(mgr, 'POST', `/workspaces/${wsId}/transfer-ownership`, { userId: amId });
  rec(handed.s < 300 && handed.j?.ownerId === amId, 'the owner hands it to another manager', brief(handed));
  await sleep(1200);
  const inbox = list((await api(am, 'GET', '/notifications?limit=50')).j);
  rec(inbox.some((n) => n.type === 'WORKSPACE_OWNERSHIP_TRANSFERRED' && n.relatedEntityId === wsId),
    'and the new owner is told', JSON.stringify(inbox.slice(0, 3).map((n) => n.type)));
  const left = await api(mgr, 'POST', `/workspaces/${wsId}/leave`);
  rec(left.s < 300, 'the former owner can now leave like anybody', brief(left));
}

// ---- losing access, and being told ----------------------------------------------------------
console.log('===== somebody switched off or declined is told so');
const p = await provision('people');
const owner = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const memberJar = await addRole(p.ws, 'MEMBER', 'role.member@strata.local');
const memberId = await whoami(memberJar);
{
  const roster = list((await api(owner, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j);
  const membership = roster.find((m) => m.userId === memberId);
  await api(owner, 'PATCH', `/workspace_members/${membership?.id}`, { status: 'INACTIVE' });
  const directory = (await api(memberJar, 'GET', '/workspaces/directory')).j ?? [];
  const entry = directory.find((w) => w.id === p.ws);
  rec(entry?.accessSwitchedOff === true,
    'a workspace whose access was switched off is listed, marked so — not hidden', JSON.stringify(entry));
  const asked = await api(memberJar, 'POST', '/join_requests', { workspaceId: p.ws, message: 'Back please' });
  const decline = await api(owner, 'POST', `/join_requests/${asked.j?.id}/reject`, {});
  rec(decline.s < 300, 'they ask to be let back in, and are declined', brief(decline));
  const after = ((await api(memberJar, 'GET', '/workspaces/directory')).j ?? []).find((w) => w.id === p.ws);
  rec(Boolean(after?.declinedAt) && after?.requested === false,
    'the directory says the request was declined, and they can ask again', JSON.stringify(after));
  await api(owner, 'PATCH', `/workspace_members/${membership?.id}`, { status: 'ACTIVE' });
}

// ---- letting somebody go --------------------------------------------------------------------
console.log('===== removing a member says what they leave behind, and tidies it');
{
  const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
  const devId = await whoami(dev);
  const task = (await api(owner, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'PPL-T-01', title: 'Left with somebody', status: 'TODO', priority: 'LOW',
    assigneeIds: [devId],
  })).j;
  let offset = 40;
  while ([0, 6].includes(new Date(Date.now() + offset * 864e5).getDay())) offset += 1;
  const day = new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const leave = (await api(dev, 'POST', '/leave_requests', { workspaceId: p.ws, type: 'CASUAL', startDate: day, endDate: day, reason: 'x' })).j;
  const roster = list((await api(owner, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j);
  const devMembership = roster.find((m) => m.userId === devId);
  const footprint = await api(owner, 'GET', `/workspace_members/${devMembership?.id}/footprint`);
  rec(footprint.j?.openTasks === 1 && footprint.j?.pendingLeave === 1,
    'asked first, the footprint names the open task and the pending leave', brief(footprint));
  const removed = await api(owner, 'DELETE', `/workspace_members/${devMembership?.id}`);
  rec(removed.s < 300, 'the member is removed', brief(removed));
  const leaveAfter = (await api(admin, 'GET', `/leave_requests/${leave?.id}`)).j;
  rec(leaveAfter?.status === 'CANCELLED', 'their pending leave is withdrawn, not left for an approver', JSON.stringify(leaveAfter?.status));
  const taskAfter = (await api(owner, 'GET', `/tasks/${task?.id}`)).j;
  rec(Array.isArray(taskAfter?.assigneeIds) && !taskAfter.assigneeIds.includes(devId),
    'and they come off the open task', JSON.stringify(taskAfter?.assigneeIds));
}

// ---- the screens ----------------------------------------------------------------------------
console.log('===== the screens: one place to add people, and no promised email');
{
  const me = (await api(owner, 'GET', '/auth/me')).j;
  rec(typeof me?.mailDelivers === 'boolean', 'the session says whether mail is delivered here', JSON.stringify({ mailDelivers: me?.mailDelivers }));
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/team?tab=add-members', 9000);
  const tabs = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
  rec(tabs.some((t) => /One person/.test(t)) && tabs.some((t) => /Several \(CSV\)/.test(t)) && tabs.some((t) => /Invite code/.test(t)),
    'Add Members holds every way in: one person, a CSV, an invite code', JSON.stringify(tabs));
  await page.getByRole('tab', { name: /Several \(CSV\)/ }).click();
  await page.waitForTimeout(500);
  rec((await page.getByRole('button', { name: 'Choose a CSV file' }).count()) > 0,
    'the CSV import is a button a keyboard can reach');
  await visit(page, '/settings?tab=workspace', 8000);
  const settingsText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec(/Adding people/.test(settingsText) && !/Role granted by the code/.test(settingsText),
    'settings points to the Team page instead of carrying a third invite-code panel', settingsText.slice(0, 300));
  await visit(page, '/workspaces', 8000);
  rec((await page.getByRole('button', { name: 'Add members' }).count()) > 0 &&
      (await page.getByRole('button', { name: /invite member/i }).count()) === 0,
    'the workspace card leads to Add Members instead of a second dialog');
  await visit(page, '/settings?tab=notifications', 8000);
  const prefs = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (me?.mailDelivers === false) {
    rec(/Email is not set up in this installation/.test(prefs), 'notification settings say email is not set up', prefs.slice(0, 300));
  }
  await visit(page, '/change-password', 6000);
  rec((await page.getByRole('link', { name: 'Cancel' }).count()) > 0, 'changing a password can be cancelled');
  await ctx.close();
}

await p.cleanup();
await api(admin, 'DELETE', `/workspaces/${wsId}?cascade=true`);
await browser.close();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

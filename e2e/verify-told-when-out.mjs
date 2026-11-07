// Somebody who loses access to a workspace — or never gets it — is told.
//
//  Being removed from a workspace, having access to it switched off, and having
//  a request to join it declined are the three things a person most needs
//  telling, and all three notices are filed under a workspace their recipient
//  cannot see into. The inbox was scoped to "workspaces you are an active
//  member of", so those notices were written and never once read — and two of
//  the three were not written at all.
//
//  API only.
import { api, provision, addRole, getJar, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const p = await provision('toldout');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const [testerId, devId] = await Promise.all([tester, dev].map(whoami));

/** The caller's notices about THIS workspace, newest first. */
const inbox = async (jar) =>
  list((await api(jar, 'GET', '/notifications?limit=100')).j).filter((n) => n.workspaceId === p.ws);
/**
 * A notice is written after the request that caused it has answered — the
 * services emit an event once the write commits — so the inbox is asked until
 * it turns up rather than once, immediately.
 */
const noticeFor = async (jar, wanted, ms = 8000) => {
  for (let waited = 0; waited <= ms; waited += 400) {
    const found = (await inbox(jar)).find(wanted);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return undefined;
};
const membershipOf = async (userId) =>
  list((await api(mgr, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j).find((m) => m.userId === userId);

// ---- access switched off ---------------------------------------------------------
console.log('===== access switched off, and back on');
{
  const member = await membershipOf(testerId);
  const off = await api(mgr, 'PATCH', `/workspace_members/${member.id}`, { status: 'INACTIVE' });
  rec(off.s === 200, 'a manager switches somebody\'s access off', brief(off));
  const shut = await api(tester, 'GET', `/projects?workspaceId=${p.ws}`);
  rec(list(shut.j).length === 0, 'they can no longer read the workspace', brief(shut));
  const notice = await noticeFor(tester, (n) => String(n.type).toLowerCase() === 'workspace_access_changed');
  rec(Boolean(notice) && /switched off/.test(notice.message) && /QA toldout/.test(notice.message),
    'and are told so, naming the workspace — in an inbox they can still open',
    JSON.stringify((await inbox(tester)).map((n) => [n.type, n.message])).slice(0, 300));

  const on = await api(mgr, 'PATCH', `/workspace_members/${member.id}`, { status: 'ACTIVE' });
  rec(on.s === 200, 'the manager switches it back on', brief(on));
  const restored = await noticeFor(tester, (n) => /switched back on/.test(n.message));
  rec(Boolean(restored), 'and they are told that too');
}

// ---- removed ------------------------------------------------------------------------
console.log('===== removed from the workspace');
{
  const member = await membershipOf(testerId);
  const gone = await api(mgr, 'DELETE', `/workspace_members/${member.id}`);
  rec([200, 204].includes(gone.s), 'the manager removes them', brief(gone));
  const notice = await noticeFor(tester, (n) => String(n.type).toLowerCase() === 'workspace_member_removed');
  rec(Boolean(notice) && /removed from/.test(notice.message),
    'the person who was removed is told', JSON.stringify((await inbox(tester)).map((n) => n.type)));
  // The inbox is theirs to manage even though the workspace no longer is.
  const read = await api(tester, 'PATCH', `/notifications/${notice?.id}`, { isRead: true });
  rec(read.s === 200 && read.j?.isRead === true, 'and can mark the notice read', brief(read));
}

// ---- left of their own accord ---------------------------------------------------------
console.log('===== leaving is not being removed');
{
  const left = await api(dev, 'POST', `/workspaces/${p.ws}/leave`, {});
  rec(left.s < 300, 'somebody leaves of their own accord', brief(left));
  // Long enough for a notice to have been written, had one been going to be.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const told = (await inbox(dev)).filter((n) => String(n.type).toLowerCase() === 'workspace_member_removed');
  rec(told.length === 0, 'and is not told they were "removed"', JSON.stringify(told.map((n) => n.message)));
  void devId;
}

// ---- a request to join, declined -------------------------------------------------------
console.log('===== a request to join, declined');
{
  const outsider = await getJar('role.developer_intern@strata.local');
  const asked = await api(outsider, 'POST', '/join_requests', { workspaceId: p.ws, message: 'May I join?' });
  rec(asked.s === 201, 'somebody outside asks to join', brief(asked));
  const no = await api(mgr, 'POST', `/join_requests/${asked.j?.id}/reject`, {});
  rec(no.s < 300, 'a manager declines', brief(no));
  const notice = await noticeFor(outsider, (n) => String(n.type).toLowerCase() === 'join_request_rejected');
  rec(Boolean(notice) && /declined/.test(notice.message),
    'the person who asked can read the answer, though they were never a member',
    JSON.stringify((await inbox(outsider)).map((n) => [n.type, n.title, n.message])));
}

// ---- and nobody else's ----------------------------------------------------------------
console.log('===== an inbox is still one person\'s');
{
  const theirs = await inbox(tester);
  const peek = await api(mgr, 'GET', `/notifications/${theirs[0]?.id}`);
  rec(peek.s === 404, 'a manager cannot open somebody else\'s notice', brief(peek));
  const mine = list((await api(mgr, 'GET', `/notifications?userId=${testerId}&limit=100`)).j);
  rec(mine.every((n) => n.userId !== testerId), 'nor list them by asking for that person\'s',
    `${mine.filter((n) => n.userId === testerId).length} of theirs came back`);
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

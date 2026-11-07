// Being added to a workspace is an invitation, and the person it is for answers it.
//
//  A manager of any workspace could put any account on the platform into theirs —
//  by e-mail on the Add Members form, or by id through POST /workspace_members — and
//  the person found a stranger's workspace in their switcher, its notices in their
//  inbox and a role in it they had never agreed to. Now:
//
//  - an add is an INVITED membership that grants nothing, for a new account as for
//    an existing one (were new accounts ACTIVE at once, the roster would tell the
//    manager which addresses already had an account);
//  - the person is told, can see the invitation although they are not a member, and
//    accepts or declines it — nobody else can, the manager included, and "Inactive"
//    is no way round it;
//  - a manager can withdraw an invitation, and the person is told;
//  - somebody who had asked to join is let in at once (they said yes already), and
//    redeeming a code while invited is a yes too, at the role the invitation offered;
//  - the screens: the invitation waits on the Workspaces page (or on the screen a
//    person with no workspace lands on), and the roster says "not joined yet".
import {
  chromium, api, adminJar, provision, addRole, getJar, signedInPage, visit, whoami, recorder, API, BASE,
} from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t).slice(0, 200)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const flat = (text) => String(text).replace(/\s+/g, ' ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One account that belongs to no workspace, reused by every run (its password is reset each time). */
const NEW_HIRE = 'e2e.newhire@strata.local';

/** One sign-in attempt, straight at the API. Waits out the login limiter. */
async function signIn(email, password) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.status === 429) { await sleep(12000); continue; }
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
const p = await provision('consent');
const WS_NAME = 'QA consent';
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrMe = (await api(mgr, 'GET', '/auth/me')).j;
const mgrName = mgrMe?.user?.name ?? mgrMe?.name ?? '';

const roster = async () => list((await api(mgr, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j);
const rowOf = async (userId) => (await roster()).find((m) => m.userId === userId);
const workspacesOf = async (jar) => list((await api(jar, 'GET', '/workspaces?limit=100')).j).map((w) => w.id);
const invitationsOf = async (jar) => list((await api(jar, 'GET', '/workspace_members/invitations')).j);
const invite = (email, roleName) =>
  api(mgr, 'POST', '/users/invite', { workspaceId: p.ws, name: email.split('@')[0], email, roleName });

try {
  // ---- an existing account is asked, not added --------------------------------------------
  console.log('===== an existing account is asked, not added');
  const tester = await getJar('role.tester@strata.local');
  const testerId = await whoami(tester);
  const sent = await invite('role.tester@strata.local', 'TESTER');
  rec(sent.s === 201 && sent.j?.invited === true && sent.j?.message === 'Invitation sent',
    'a manager adding an existing account sends an invitation', brief(sent));
  const row = await rowOf(testerId);
  rec(row?.status === 'INVITED', 'the roster shows them invited, not in', JSON.stringify(row));
  rec(!(await workspacesOf(tester)).includes(p.ws), 'they have no access yet: the workspace is not in their list');
  const projects = await api(tester, 'GET', `/projects?workspaceId=${p.ws}`);
  rec(projects.s === 403 || list(projects.j).length === 0, 'nor can they read its projects', brief(projects));

  await sleep(1200); // the audit row that names the inviter is written after the commit
  const waiting = await invitationsOf(tester);
  const mine = waiting.find((i) => i.workspaceId === p.ws);
  rec(mine?.workspaceName === WS_NAME && mine?.role === 'TESTER' && mine?.invitedByName === mgrName,
    'their invitations list it: the workspace, the role, and who sent it', JSON.stringify(waiting));
  const notes = list((await api(tester, 'GET', '/notifications?limit=100')).j);
  const notice = notes.find((n) => n.type === 'WORKSPACE_INVITATION' && n.relatedEntityId === p.ws);
  rec(Boolean(notice) && /invited you to/.test(notice?.message ?? ''),
    'they are told, in an inbox that reaches somebody outside the workspace', JSON.stringify(notice ?? notes.slice(0, 2)));

  // ---- it is theirs to answer -----------------------------------------------------------
  console.log('===== it is theirs to answer');
  const forThem = await api(mgr, 'PATCH', `/workspace_members/${row?.id}`, { status: 'ACTIVE' });
  rec(forThem.s === 403, 'a manager cannot accept it for them', brief(forThem));
  const parked = await api(mgr, 'PATCH', `/workspace_members/${row?.id}`, { status: 'INACTIVE' });
  rec(parked.s === 403, 'nor park it as Inactive, one switch away from Active', brief(parked));
  const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
  const stranger = await api(dev, 'POST', `/workspace_members/${row?.id}/accept`, {});
  rec(stranger.s === 404, 'nobody else can accept it either', brief(stranger));
  const twice = await invite('role.tester@strata.local', 'TESTER');
  rec(twice.s === 400 && /already been invited/.test(twice.t), 'a second invitation waits on the first', brief(twice));

  const yes = await api(tester, 'POST', `/workspace_members/${row?.id}/accept`, {});
  rec(yes.s === 200 && yes.j?.status === 'ACTIVE', 'they accept it', brief(yes));
  rec((await workspacesOf(tester)).includes(p.ws), 'and the workspace is theirs to open');
  rec(!(await invitationsOf(tester)).some((i) => i.workspaceId === p.ws), 'the invitation leaves their list');
  const accepted = await rowOf(testerId);
  rec(accepted?.status === 'ACTIVE' && accepted?.role === 'TESTER',
    'the roster shows them in, at the role they were offered', JSON.stringify(accepted));

  // ---- declined --------------------------------------------------------------------------
  console.log('===== declined');
  const intern = await getJar('role.developer_intern@strata.local');
  const internId = await whoami(intern);
  await invite('role.developer_intern@strata.local', 'DEVELOPER_INTERN');
  const internRow = await rowOf(internId);
  const no = await api(intern, 'POST', `/workspace_members/${internRow?.id}/decline`, {});
  rec(no.s === 204, 'the person declines', brief(no));
  rec((await rowOf(internId)) === undefined, 'and the invitation is gone from the roster');
  rec(!(await workspacesOf(intern)).includes(p.ws), 'they were never let in');
  const late = await api(intern, 'POST', `/workspace_members/${internRow?.id}/accept`, {});
  rec(late.s === 404, 'a declined invitation cannot be accepted afterwards', brief(late));

  // ---- withdrawn -------------------------------------------------------------------------
  console.log('===== withdrawn');
  const ce = await getJar('role.content_engineer@strata.local');
  const ceId = await whoami(ce);
  await invite('role.content_engineer@strata.local', 'CONTENT_ENGINEER');
  const ceRow = await rowOf(ceId);
  const back = await api(mgr, 'DELETE', `/workspace_members/${ceRow?.id}`);
  rec(back.s === 204, 'a manager withdraws an unanswered invitation', brief(back));
  rec(!(await invitationsOf(ce)).some((i) => i.workspaceId === p.ws), 'it leaves the person’s list');
  await sleep(800);
  const ceNotes = list((await api(ce, 'GET', '/notifications?limit=100')).j);
  rec(ceNotes.some((n) => n.relatedEntityId === p.ws && n.title === 'Invitation withdrawn'),
    'and they are told it was withdrawn — not that they were "removed"',
    JSON.stringify(ceNotes.filter((n) => n.relatedEntityId === p.ws)));
  const tooLate = await api(ce, 'POST', `/workspace_members/${ceRow?.id}/accept`, {});
  rec(tooLate.s === 404, 'a withdrawn invitation cannot be accepted', brief(tooLate));

  // ---- consent given already --------------------------------------------------------------
  console.log('===== somebody who asked to join is let in at once');
  const am = await getJar('role.assistant_manager@strata.local');
  const amId = await whoami(am);
  const asked = await api(am, 'POST', '/join_requests', { workspaceId: p.ws, message: 'May I join?' });
  rec(asked.s < 300, 'an account asks to join', brief(asked));
  const answered = await invite('role.assistant_manager@strata.local', 'MEMBER');
  rec(answered.s === 201 && answered.j?.invited === false, 'adding them answers it: no invitation needed', brief(answered));
  rec((await rowOf(amId))?.status === 'ACTIVE', 'they are in at once');
  const pending = list((await api(mgr, 'GET', `/join_requests?workspaceId=${p.ws}&status=PENDING&limit=100`)).j);
  rec(!pending.some((r) => r.userId === amId), 'and their request is no longer waiting on a decision', JSON.stringify(pending));

  console.log('===== redeeming a code while invited is a yes');
  const member = await getJar('role.member@strata.local');
  const memberId = await whoami(member);
  await invite('role.member@strata.local', 'CONTENT_ENGINEER');
  const code = (await api(admin, 'POST', '/invite_codes', { workspaceId: p.ws, role: 'MEMBER', maxUses: 3 })).j;
  const redeemed = await api(member, 'POST', '/workspaces/accept-invitation', { code: code?.code });
  rec(redeemed.s < 300 && redeemed.j?.role === 'CONTENT_ENGINEER',
    'redeeming a code accepts the invitation, at the role it offered', brief(redeemed));
  rec((await rowOf(memberId))?.status === 'ACTIVE', 'they are in');
  const codeAfter = list((await api(admin, 'GET', `/invite_codes?workspaceId=${p.ws}&limit=50`)).j)
    .find((c) => c.code === code?.code);
  rec(codeAfter && Number(codeAfter.usedCount) === 0, 'and no seat of the code was spent on it', JSON.stringify(codeAfter));

  // ---- the screens ----------------------------------------------------------------------
  console.log('===== on screen: the invited person');
  {
    // Declined above, so this is a fresh invitation. Where it shows depends on whether
    // the intern belongs to any workspace: with none, the guard's "no workspace" screen
    // (where somebody a manager made an account for lands); otherwise the Workspaces page.
    await invite('role.developer_intern@strata.local', 'DEVELOPER_INTERN');
    const hadNone = (await workspacesOf(intern)).length === 0;
    const { ctx, page, errors } = await signedInPage(browser, 'role.developer_intern@strata.local');
    await visit(page, '/workspaces', 6000);
    const heading = page.getByText(/invitation is waiting for you|invitations are waiting for you/);
    const shown = await heading.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const text = flat(await page.locator('body').innerText().catch(() => ''));
    rec(shown && text.includes(WS_NAME) && /not a member until you accept/.test(text),
      `the invitation waits for them on ${hadNone ? 'the screen somebody with no workspace sees' : 'the Workspaces page'}`,
      text.slice(0, 400));
    const accept = page.getByRole('button', { name: `Accept the invitation to ${WS_NAME}` });
    if (await accept.count()) {
      await accept.click();
      let joined = false;
      for (let i = 0; i < 20 && !joined; i += 1) {
        await page.waitForTimeout(500);
        joined = (await rowOf(internId))?.status === 'ACTIVE';
      }
      rec(joined, 'Accept lets them in');
      await page.waitForTimeout(2500);
      const after = flat(await page.locator('body').innerText().catch(() => ''));
      rec(!/invitation is waiting for you/.test(after), 'and the invitation leaves the screen', after.slice(0, 300));
    } else {
      rec(false, 'Accept lets them in', 'no Accept button for the workspace');
    }
    rec(errors.length === 0, 'no page threw', errors.join(' | '));
    await ctx.close();
  }

  console.log('===== on screen: somebody new, who belongs to no workspace yet');
  {
    // The commonest way in: a manager adds a new hire. They are invited like anybody
    // else, so their first screen after choosing a password has to offer the invitation.
    const hired = await invite(NEW_HIRE, 'SOFTWARE_DEVELOPER');
    const hireId = hired.j?.userId;
    rec(hired.s === 201 && hired.j?.invited === true, 'a manager adds somebody new: they are invited too', brief(hired));
    // An earlier run left this account with a password of its own choosing, and an
    // account that has set its own is no longer a workspace manager's to reset. A
    // platform administrator puts it back on a temporary one, so every run starts
    // where a new hire starts: never signed in.
    const reset = await api(admin, 'POST', `/users/${hireId}/temp-password`, { workspaceId: p.ws });
    rec(reset.s < 300, 'the account starts the run on a temporary password', brief(reset));
    // While the membership is only an invitation, the inviting manager can still issue
    // the account a password — or a lost first password would lock it out of the one
    // step that lets it in.
    const issued = await api(mgr, 'POST', `/users/${hireId}/temp-password`, { workspaceId: p.ws });
    rec(issued.s < 300, 'the inviting manager can issue an invited account a new temporary password', brief(issued));
    const temp = issued.j?.temporaryPassword;
    if (!temp) {
      console.log('   this installation mails temporary passwords; the new-hire screen was skipped');
    } else {
      const first = await signIn(NEW_HIRE, temp);
      const chosen = 'Joined-By-Choice-5182';
      const changed = await api(first.jar, 'POST', '/auth/change-password', { currentPassword: temp, newPassword: chosen });
      rec(changed.s < 300, 'they sign in on it and choose their own password', brief(changed));
      const session = await signIn(NEW_HIRE, chosen);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      await ctx.addCookies([...session.jar].map(([name, value]) => ({ name, value, url: BASE })));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      await visit(page, '/dashboard', 6000);
      const heading = page.getByText(/invitation is waiting for you/);
      const shown = await heading.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const text = flat(await page.locator('body').innerText().catch(() => ''));
      rec(shown && /No workspace open to you/.test(text) && text.includes(WS_NAME),
        'with no workspace yet, the first screen they reach offers the invitation', text.slice(0, 400));
      const accept = page.getByRole('button', { name: `Accept the invitation to ${WS_NAME}` });
      if (await accept.count()) {
        await accept.click();
        const inside = await page
          .locator('#main-content')
          .waitFor({ state: 'attached', timeout: 25000 })
          .then(() => true, () => false);
        rec(inside && (await rowOf(hireId))?.status === 'ACTIVE' && /\/dashboard/.test(page.url()),
          'Accept takes them into the workspace', page.url());
      } else {
        rec(false, 'Accept takes them into the workspace', 'no Accept button on the screen');
      }
      rec(errors.length === 0, 'no page threw', errors.join(' | '));
      await ctx.close();
    }
  }

  console.log('===== on screen: the manager');
  {
    await invite('role.content_engineer@strata.local', 'CONTENT_ENGINEER');
    const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
    await visit(page, '/team', 7000);
    const main = flat(await page.locator('main').innerText().catch(() => ''));
    rec(/Invited \(not joined yet\)/.test(main), 'the roster says an invited person has not joined yet', main.slice(0, 400));
    await visit(page, '/team?tab=add-members', 6000);
    const form = flat(await page.locator('main').innerText().catch(() => ''));
    rec(/Everybody you add is invited/.test(form), 'the Add Members form says adding is inviting', form.slice(0, 400));
    rec(errors.length === 0, 'no page threw', errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  await p.cleanup();
}

const rows = summary();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

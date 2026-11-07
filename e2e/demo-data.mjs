// A realistic demo workspace, so every screen has something on it.
//
//   pnpm demo:data            create "Demo Company" (does nothing if it already exists)
//   pnpm demo:data -- --reset delete it first, then create it again
//
// Goes through the public API exactly as the UI would, so the data is shaped by the same
// rules a user's would be (permissions, validation, hierarchy ids, the DONE-needs-REVIEW rule).
// One exception, explained where it happens: membership dates are backdated in the database,
// because the API has no way to say somebody joined six weeks ago.
//
// After it runs, sign in as any of the seeded accounts and each sees the workspace with the
// role the table below gives them:
//
//   admin@strata.local                    platform admin, owner
//   role.manager@strata.local             MANAGER
//   role.assistant_manager@strata.local   ASSISTANT_MANAGER
//   role.software_developer@strata.local  SOFTWARE_DEVELOPER
//   role.tester@strata.local              TESTER
//   role.developer_intern@strata.local    DEVELOPER_INTERN
//   role.content_engineer@strata.local    CONTENT_ENGINEER
//   role.member@strata.local              MEMBER
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { api, adminJar, getJar, whoami, FIXTURES } from './kit.mjs';

const API = 'http://localhost:8000/api/v1';
// DEMO_WORKSPACE_NAME builds the same data under another name — e.g. a scratch copy to
// run destructive tests against, leaving "Demo Company" untouched.
const NAME = process.env.DEMO_WORKSPACE_NAME || 'Demo Company';
const RESET = process.argv.includes('--reset');

const ROLES = ['MANAGER', 'ASSISTANT_MANAGER', 'SOFTWARE_DEVELOPER', 'TESTER', 'DEVELOPER_INTERN', 'CONTENT_ENGINEER', 'MEMBER'];
const emailOf = (role) => `role.${role.toLowerCase()}@strata.local`;

let made = 0;
const problems = [];
/** Run one API call; keep the body, count failures instead of stopping. */
async function ok(label, call) {
  const r = await call();
  if (r.s >= 200 && r.s < 300) { made += 1; return r.j; }
  problems.push(`${label}: ${r.s} ${String(r.t).slice(0, 140)}`);
  return null;
}

// The login limiter is 5/min. The session cache absorbs most of it; ride out the rest.
async function jarFor(email) {
  for (let i = 0; i < 3; i += 1) {
    try { return await getJar(email); } catch (e) {
      if (!/429|too many/i.test(String(e))) throw e;
      console.log(`  login limiter hit for ${email}; waiting out the window…`);
      await new Promise((r) => setTimeout(r, 62_000));
    }
  }
  throw new Error(`could not sign in as ${email}`);
}

const admin = await adminJar();

// ---- the workspace ------------------------------------------------------------------
const existing = ((await api(admin, 'GET', '/workspaces')).j?.items ?? []).find((w) => w.name === NAME);
if (existing && !RESET) {
  console.log(`"${NAME}" already exists (${existing.id}). Re-run with --reset to rebuild it.`);
}
// Everything below runs only when there is something to build. (Not an early process.exit:
// exiting in the same tick as a fetch trips a libuv assertion on Windows.)
if (!(existing && !RESET)) {
if (existing && RESET) {
  const del = await api(admin, 'DELETE', `/workspaces/${existing.id}?cascade=true`);
  console.log(`removed the old "${NAME}" -> ${del.s}`);
}

const ws = (await ok('workspace', () => api(admin, 'POST', '/workspaces', {
  name: NAME,
  description: 'Sample company with three projects, a full team and a few weeks of history.',
})))?.id;
if (!ws) { console.error(problems.join('\n')); process.exit(1); }
console.log(`workspace ${ws}`);

// ---- the team: every seeded role account joins through an invite code ---------------
const jars = { ADMIN: admin };
const ids = { ADMIN: await whoami(admin) };
for (const role of ROLES) {
  const code = (await ok(`invite code ${role}`, () => api(admin, 'POST', '/invite_codes', { workspaceId: ws, role, maxUses: 3 })))?.code;
  const jar = await jarFor(emailOf(role));
  await ok(`join as ${role}`, () => api(jar, 'POST', '/workspaces/accept-invitation', { code }));
  jars[role] = jar;
  ids[role] = await whoami(jar);
}
console.log(`team: ${ROLES.length} role accounts joined`);

// Everybody "joined" six weeks ago. Attendance analytics only counts days since a person
// joined, so history seeded below would otherwise sit before the join date and the screen
// would say "No completed working days in this period yet" over a fortnight of records.
// joinedAt cannot be set through the API, so this one statement goes to the database; if
// Postgres is not reachable this way the demo still works, with that one screen sparse.
try {
  execFileSync('docker', ['exec', 'strata-postgres-1', 'psql', '-U', 'postgres', '-d', 'strata', '-qAtc',
    `update workspaces_workspacemember set joined_at = now() - interval '45 days' where workspace_id = '${ws}'`], { stdio: 'pipe' });
  console.log('membership dates set 45 days back');
} catch (e) {
  console.log('note: could not backdate membership dates (' + String(e.message).slice(0, 80).replace(/\s+/g, ' ') + ')');
}

const MGR = jars.MANAGER;
const dev = ['SOFTWARE_DEVELOPER', 'DEVELOPER_INTERN', 'TESTER', 'CONTENT_ENGINEER'];

// ---- calendar helpers ----------------------------------------------------------------
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const isWeekday = (iso) => { const w = new Date(iso + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6; };
const weekdaysBack = (n) => { const out = []; for (let o = -1; out.length < n; o -= 1) if (isWeekday(day(o))) out.push(day(o)); return out; };
// A wall-clock time on that day, in the timezone of the machine running this (which is the
// server's, and so the workspace's default working-day timezone). Written as UTC the app
// reads a 09:00 check-in as mid-afternoon and marks everybody late.
const at = (iso, h, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();

// ---- projects ------------------------------------------------------------------------
const mkProject = (name, shortCode, extra) => ok(`project ${name}`, () => api(MGR, 'POST', '/projects', {
  workspaceId: ws, name, shortCode, ...extra,
}));
const ecom = await mkProject('E-Commerce Platform', 'ECOM', { clientName: 'Northwind Retail', description: 'Storefront, cart, checkout and order tracking.', status: 'ACTIVE', startDate: day(-45), endDate: day(75) });
const bank = await mkProject('Mobile Banking App', 'MBNK', { clientName: 'Contoso Bank', description: 'Account overview, transfers and card controls for iOS and Android.', status: 'PLANNING', startDate: day(14), endDate: day(160) });
const hr = await mkProject('Internal HR Portal', 'HRPT', { clientName: 'Internal', description: 'Leave, payslips and onboarding for staff.', status: 'COMPLETED', startDate: day(-120), endDate: day(-20) });
console.log(`projects: ${[ecom, bank, hr].filter(Boolean).length}/3`);

// ---- ids ---------------------------------------------------------------------------------
// The same shapes the app generates (apps/frontend/src/lib/hierarchy-id-generator.ts and
// use-epic.ts), so seeded rows are indistinguishable from ones made in the UI:
//   epic   ECOM-EPIC-01          requirement   ECOM-CUS-CAT-CAT-01   (project-CR-epic-FR-n)
//   task   <requirement id>-CAR-01 when it implements a requirement, else ECOM-T07
const abbr = (text) => String(text ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
const two = (n) => String(n).padStart(2, '0');

// ---- requirements → epics → functional requirements ---------------------------------
async function plan(project, code, tree) {
  const crs = [], epics = [], frs = [];
  let n = 0;
  for (const cr of tree) {
    const c = await ok(`client requirement ${cr.title}`, () => api(MGR, 'POST', '/client_requirements', {
      workspaceId: ws, projectId: project.id, title: cr.title, description: cr.description, clientName: project.clientName,
      priority: cr.priority, status: cr.status ?? 'APPROVED',
    }));
    if (!c) continue;
    crs.push(c);
    const e = await ok(`epic ${cr.epic}`, () => api(MGR, 'POST', '/epics', {
      workspaceId: ws, projectId: project.id, hierarchyId: `${code}-EPIC-${two(epics.length + 1)}`, name: cr.epic, requirementId: c.id,
      description: cr.description,
      startDate: day(-30), endDate: day(40),
    }));
    if (e) epics.push(e);
    for (const [k, fr] of cr.frs.entries()) {
      n += 1;
      // Created as DRAFT and then moved: the create endpoint validates `status` against the
      // CLIENT-requirement list (it refuses REVIEW / IMPLEMENTED / TESTED / DEPLOYED, which the
      // update endpoint and the UI use), so a requirement can only get those by an update.
      const f = await ok(`functional requirement ${fr}`, () => api(MGR, 'POST', '/functional_requirements', {
        workspaceId: ws, projectId: project.id, hierarchyId: `${code}-${abbr(cr.title)}-${abbr(cr.epic)}-${abbr(fr)}-${two(n)}`, title: fr, clientRequirementId: c.id,
        epicId: e?.id, status: 'DRAFT', complexity: ['LOW', 'MEDIUM', 'HIGH'][n % 3], type: 'FUNCTIONAL',
        // Always set: the create dialog requires a priority, and a requirement saved without
        // one cannot be cloned (the clone re-sends priority "" and the API refuses it).
        priority: cr.priority === 'CRITICAL' ? 'HIGH' : cr.priority,
      }));
      if (!f) continue;
      const wanted = cr.frStatuses?.[k] ?? cr.frStatus ?? 'APPROVED';
      if (wanted !== 'DRAFT') await ok(`FR ${fr} -> ${wanted}`, () => api(MGR, 'PATCH', `/functional_requirements/${f.id}`, { status: wanted }));
      frs.push(f);
    }
  }
  return { crs, epics, frs };
}

const ecomPlan = ecom && await plan(ecom, 'ECOM', [
  { title: 'Customers can browse and search the catalogue', description: 'Category pages, filters, full-text search with typo tolerance.', priority: 'HIGH', epic: 'Catalogue & Search', progress: 70, frStatuses: ['DEPLOYED', 'TESTED', 'IMPLEMENTED'], frs: ['Category listing with filters', 'Product detail page', 'Search with suggestions'] },
  { title: 'Customers can pay by card, wallet or bank transfer', description: 'PCI-compliant checkout, saved payment methods, 3-D Secure.', priority: 'CRITICAL', epic: 'Checkout & Payments', progress: 40, frStatuses: ['IMPLEMENTED', 'REVIEW', 'APPROVED'], frs: ['Cart and promo codes', 'Card payment form', 'Order confirmation e-mail'] },
  { title: 'Customers can track orders and request returns', description: 'Order history, live shipment status, return labels.', priority: 'MEDIUM', epic: 'Orders & Returns', progress: 10, frStatus: 'DRAFT', frs: ['Order history page', 'Return request flow'] },
  { title: 'Staff can manage stock and prices', description: 'Back-office screens for inventory and price lists.', priority: 'LOW', status: 'SUBMITTED', epic: 'Back Office', epicStatus: 'TODO', frs: ['Inventory screen'] },
]);
const bankPlan = bank && await plan(bank, 'MBNK', [
  { title: 'Customers can see balances and transactions', description: 'Real-time balances, searchable history.', priority: 'HIGH', epic: 'Accounts', epicStatus: 'TODO', frs: ['Account overview', 'Transaction search'] },
  { title: 'Customers can send money', description: 'Domestic and international transfers with beneficiary management.', priority: 'CRITICAL', epic: 'Transfers', epicStatus: 'TODO', frs: ['Add beneficiary', 'Transfer with OTP'] },
]);
const hrPlan = hr && await plan(hr, 'HRPT', [
  { title: 'Staff can request leave online', description: 'Leave requests with manager approval.', priority: 'HIGH', epic: 'Leave', epicStatus: 'DONE', progress: 100, frStatus: 'DEPLOYED', frs: ['Leave request form', 'Approval queue'] },
]);
console.log(`requirements/epics/functional: ecom ${ecomPlan?.frs.length ?? 0} FRs, bank ${bankPlan?.frs.length ?? 0}, hr ${hrPlan?.frs.length ?? 0}`);

// ---- sprints --------------------------------------------------------------------------
const mkSprint = (project, name, goal, from, to) => ok(`sprint ${name}`, () => api(MGR, 'POST', '/sprints', {
  workspaceId: ws, projectId: project.id, name, goal, startDate: from, endDate: to,
}));
const s1 = ecom && await mkSprint(ecom, 'Sprint 1 — Foundations', 'Catalogue browsing and the design system.', day(-26), day(-13));
const s2 = ecom && await mkSprint(ecom, 'Sprint 2 — Checkout', 'Cart, promo codes and card payments end to end.', day(-6), day(7));
const s3 = ecom && await mkSprint(ecom, 'Sprint 3 — Orders', 'Order history and returns.', day(8), day(21));
const s4 = bank && await mkSprint(bank, 'Sprint 1 — Discovery', 'Prototype account overview.', day(14), day(28));
const s5 = hr && await mkSprint(hr, 'Sprint 1 — Leave', 'Leave request and approval.', day(-60), day(-47));

// ---- tasks -----------------------------------------------------------------------------
const perProject = new Map();      // ECOM-T01, ECOM-T02 … numbered per project, as the app does
const perRequirement = new Map();
async function task(project, code, sprint, t) {
  let hierarchyId;
  if (t.fr) {
    const k = (perRequirement.get(t.fr.id) ?? 0) + 1;
    perRequirement.set(t.fr.id, k);
    hierarchyId = `${t.fr.hierarchyId}-${abbr(t.title) || two(k)}-${two(k)}`;
  } else {
    const k = (perProject.get(code) ?? 0) + 1;
    perProject.set(code, k);
    hierarchyId = `${code}-T${two(k)}`;
  }
  const created = await ok(`task ${t.title}`, () => api(MGR, 'POST', '/tasks', {
    workspaceId: ws, projectId: project.id, hierarchyId, title: t.title, description: t.description ?? '',
    sprintId: sprint?.id, epicId: t.epic?.id, functionalRequirementId: t.fr?.id, priority: t.priority ?? 'MEDIUM',
    status: t.status === 'DONE' ? 'IN_PROGRESS' : (t.status ?? 'BACKLOG'),
    assigneeIds: t.who ? [ids[t.who]] : [],
    // Labels are "color:text" STRINGS — the shape the task dialogs write. The API accepts any
    // array here, and a non-string label makes eight render paths call label.split() and crash.
    dueDate: t.due, estimatedHours: t.hours ?? 4, labels: t.labels ?? [],
  }));
  if (!created) return null;
  if (t.status === 'DONE') {
    await ok(`task ${t.title} -> review`, () => api(MGR, 'PATCH', `/tasks/${created.id}`, { status: 'REVIEW' }));
    await ok(`task ${t.title} -> done`, () => api(MGR, 'PATCH', `/tasks/${created.id}`, { status: 'DONE' }));
  }
  return created;
}

const E = ecomPlan?.epics ?? [], F = ecomPlan?.frs ?? [];
const ecomTasks = {};
if (ecom) {
  const spec = (arr, sprint) => Promise.all([]).then(async () => { const out = []; for (const t of arr) out.push(await task(ecom, 'ECOM', sprint, t)); return out; });
  // Sprint 1 — finished
  await spec([
    { title: 'Design system: tokens and components', status: 'DONE', who: 'CONTENT_ENGINEER', epic: E[0], fr: F[0], priority: 'HIGH', hours: 16, due: day(-18) },
    { title: 'Category listing page', status: 'DONE', who: 'SOFTWARE_DEVELOPER', epic: E[0], fr: F[0], priority: 'HIGH', hours: 12, due: day(-16) },
    { title: 'Product detail page', status: 'DONE', who: 'DEVELOPER_INTERN', epic: E[0], fr: F[1], hours: 10, due: day(-15) },
    { title: 'Search endpoint with typo tolerance', status: 'DONE', who: 'SOFTWARE_DEVELOPER', epic: E[0], fr: F[2], priority: 'HIGH', hours: 14, due: day(-14) },
    { title: 'Regression pass on catalogue', status: 'DONE', who: 'TESTER', epic: E[0], hours: 6, due: day(-13) },
  ], s1);
  // Sprint 2 — in flight, every column populated, some overdue
  const sp2 = await spec([
    { title: 'Cart service and promo code engine', status: 'IN_PROGRESS', who: 'SOFTWARE_DEVELOPER', epic: E[1], fr: F[3], priority: 'CRITICAL', hours: 20, due: day(2), labels: ['blue:backend'] },
    { title: 'Card payment form with 3-D Secure', status: 'IN_PROGRESS', who: 'SOFTWARE_DEVELOPER', epic: E[1], fr: F[4], priority: 'CRITICAL', hours: 24, due: day(-1), labels: ['red:payments', 'orange:blocked'] },
    { title: 'Order confirmation e-mail template', status: 'REVIEW', who: 'CONTENT_ENGINEER', epic: E[1], fr: F[5], priority: 'MEDIUM', hours: 6, due: day(3) },
    { title: 'Checkout UI polish and empty states', status: 'REVIEW', who: 'DEVELOPER_INTERN', epic: E[1], priority: 'LOW', hours: 8, due: day(4) },
    { title: 'Write checkout test plan', status: 'TODO', who: 'TESTER', epic: E[1], priority: 'HIGH', hours: 5, due: day(1) },
    { title: 'Wire promo banner into the home page', status: 'TODO', who: 'DEVELOPER_INTERN', epic: E[1], priority: 'LOW', hours: 3, due: day(5) },
    { title: 'Rate-limit the payment endpoint', status: 'TODO', who: 'SOFTWARE_DEVELOPER', epic: E[1], priority: 'HIGH', hours: 4, due: day(-3) },
    { title: 'Accessibility audit of checkout', status: 'BACKLOG', who: 'TESTER', epic: E[1], priority: 'MEDIUM', hours: 8 },
    { title: 'Apple Pay / Google Pay spike', status: 'DONE', who: 'SOFTWARE_DEVELOPER', epic: E[1], priority: 'LOW', hours: 5, due: day(-2) },
  ], s2);
  ecomTasks.sp2 = sp2;
  // Sprint 3 — planned
  await spec([
    { title: 'Order history page', status: 'BACKLOG', who: 'DEVELOPER_INTERN', epic: E[2], fr: F[6], priority: 'MEDIUM', hours: 10 },
    { title: 'Return request flow', status: 'BACKLOG', who: 'SOFTWARE_DEVELOPER', epic: E[2], fr: F[7], priority: 'MEDIUM', hours: 16 },
    { title: 'Shipment tracking integration', status: 'BACKLOG', epic: E[2], priority: 'HIGH', hours: 12 },
  ], s3);
  // Unplanned backlog (no sprint)
  await spec([
    { title: 'Inventory screen for staff', status: 'BACKLOG', epic: E[3], fr: F[8], priority: 'LOW', hours: 12 },
    { title: 'Bulk price import (CSV)', status: 'BACKLOG', epic: E[3], priority: 'LOW', hours: 8 },
    { title: 'Wishlist', status: 'BACKLOG', priority: 'LOW', hours: 10 },
  ], null);
}
if (bank) {
  for (const t of [
    { title: 'Prototype account overview in Figma', who: 'CONTENT_ENGINEER', status: 'BACKLOG', epic: bankPlan?.epics[0], priority: 'HIGH', hours: 12 },
    { title: 'Threat model for transfers', who: 'TESTER', status: 'BACKLOG', epic: bankPlan?.epics[1], priority: 'CRITICAL', hours: 10 },
    { title: 'Choose the mobile framework', who: 'SOFTWARE_DEVELOPER', status: 'BACKLOG', priority: 'HIGH', hours: 6 },
  ]) await task(bank, 'MBNK', s4, t);
}
if (hr) {
  for (const t of [
    { title: 'Leave request form', who: 'SOFTWARE_DEVELOPER', status: 'DONE', epic: hrPlan?.epics[0], hours: 10 },
    { title: 'Manager approval queue', who: 'SOFTWARE_DEVELOPER', status: 'DONE', epic: hrPlan?.epics[0], hours: 12 },
  ]) await task(hr, 'HRPT', s5, t);
}

// start / complete the sprints the way the UI does
const startSprint = async (sprint, project) => {
  if (!sprint) return;
  await ok(`start ${sprint.name}`, () => api(MGR, 'PATCH', `/sprints/${sprint.id}`, { status: 'ACTIVE' }));
  const backlog = ((await api(MGR, 'GET', `/tasks?projectId=${project.id}&sprintId=${sprint.id}&status=BACKLOG&pageSize=200`)).j?.items ?? []);
  for (const t of backlog) await api(MGR, 'PATCH', `/tasks/${t.id}`, { status: 'TODO' });
};
await startSprint(s1, ecom);
await ok('complete sprint 1', () => api(MGR, 'POST', `/sprints/${s1?.id}/complete`, {}));
await startSprint(s2, ecom);
await startSprint(s5, hr);
await ok('complete HR sprint', () => api(MGR, 'POST', `/sprints/${s5?.id}/complete`, {}));
// A sprint's retrospective is its own `retrospectiveNotes` — the field the
// completion dialog fills in and the analytics page shows.
if (s1) await ok('retrospective notes', () => api(MGR, 'PATCH', `/sprints/${s1.id}`, {
  retrospectiveNotes: [
    'Went well: the design system landed early, and search quality exceeded the target.',
    'To improve: estimates were optimistic, and the review queue backed up mid-sprint.',
    'Actions: reserve Thursday afternoons for code review; re-estimate with the team before planning.',
  ].join('\n'),
}));

// ---- dependencies, comments ------------------------------------------------------------
const sp2Tasks = (ecomTasks.sp2 ?? []).filter(Boolean);
if (sp2Tasks.length > 4) {
  await ok('dependency', () => api(MGR, 'POST', `/tasks/${sp2Tasks[1].id}/dependencies`, { targetTaskId: sp2Tasks[0].id, type: 'blockedBy' }));
  await ok('dependency 2', () => api(MGR, 'POST', `/tasks/${sp2Tasks[2].id}/dependencies`, { targetTaskId: sp2Tasks[1].id, type: 'blockedBy' }));
  const talk = [
    ['SOFTWARE_DEVELOPER', sp2Tasks[1], 'Stripe sandbox is returning a 3-D Secure challenge on every test card — checking whether that is the account setting.'],
    ['TESTER', sp2Tasks[1], 'Can we get a failing-card test number into the fixtures? I need declined, expired and insufficient-funds cases.'],
    ['MANAGER', sp2Tasks[1], 'This one is blocking the confirmation e-mail. Flag it in standup if it slips past tomorrow.'],
    ['CONTENT_ENGINEER', sp2Tasks[2], 'Draft copy attached in the doc. Subject line is under 50 characters so it will not truncate on mobile.'],
    ['DEVELOPER_INTERN', sp2Tasks[3], 'Is the empty-cart illustration final? I used the placeholder.'],
  ];
  for (const [who, t, content] of talk) await ok(`comment by ${who}`, () => api(jars[who], 'POST', '/task_comments', { taskId: t.id, content }));
}

// ---- time tracking -----------------------------------------------------------------------
const back = weekdaysBack(8);
const entries = [];
for (const [i, who] of ['SOFTWARE_DEVELOPER', 'SOFTWARE_DEVELOPER', 'DEVELOPER_INTERN', 'TESTER', 'CONTENT_ENGINEER', 'SOFTWARE_DEVELOPER', 'TESTER', 'DEVELOPER_INTERN'].entries()) {
  const d = back[i % back.length];
  const task = sp2Tasks[i % Math.max(sp2Tasks.length, 1)];
  const e = await ok(`time entry ${who}`, () => api(jars[who], 'POST', '/time_entries', {
    workspaceId: ws, projectId: ecom?.id, taskId: task?.id, taskTitle: task?.title, description: `Worked on ${task?.title ?? 'sprint tasks'}`,
    startTime: at(d, 9), endTime: at(d, 9 + 2 + (i % 4)), isBillable: i % 2 === 0, tags: i % 3 === 0 ? ['feature'] : [],
  }));
  if (e) entries.push(e);
}
for (const [i, e] of entries.entries()) {
  if (i % 3 === 0) await ok('approve time', () => api(MGR, 'POST', `/time_entries/${e.id}/approve`, {}));
  else if (i % 3 === 1) await ok('reject time', () => api(MGR, 'POST', `/time_entries/${e.id}/reject`, { reason: 'Please link this to a task and resubmit.' }));
}   // the rest stay pending, so the Approvals tab has a queue

// ---- leave --------------------------------------------------------------------------------
const leave = async (who, type, from, to, reason, decision) => {
  const r = await ok(`leave ${who}`, () => api(jars[who], 'POST', '/leave_requests', { workspaceId: ws, type, startDate: from, endDate: to, reason }));
  if (r && decision === 'approve') await ok('approve leave', () => api(MGR, 'POST', `/leave_requests/${r.id}/approve`, {}));
  if (r && decision === 'reject') await ok('reject leave', () => api(MGR, 'POST', `/leave_requests/${r.id}/reject`, { reason: 'Release week — please pick another date.' }));
};
const nextWeekday = (offset) => { let o = offset; while (!isWeekday(day(o))) o += 1; return day(o); };
await leave('SOFTWARE_DEVELOPER', 'ANNUAL', nextWeekday(14), nextWeekday(16), 'Family wedding', 'approve');
await leave('TESTER', 'SICK', nextWeekday(1), nextWeekday(1), 'Dental appointment', null);
await leave('DEVELOPER_INTERN', 'CASUAL', nextWeekday(5), nextWeekday(5), 'Moving flat', 'reject');
await leave('MEMBER', 'ANNUAL', nextWeekday(25), nextWeekday(29), 'Holiday', null);
await leave('CONTENT_ENGINEER', 'HALF_DAY', nextWeekday(9), nextWeekday(9), 'School event', 'approve');

// ---- attendance: a fortnight of history, and today ---------------------------------------
for (const d of weekdaysBack(10)) {
  for (const who of [...dev, 'MEMBER', 'ASSISTANT_MANAGER']) {
    const late = (d.charCodeAt(9) + who.length) % 7 === 0;
    await ok('attendance', () => api(MGR, 'POST', '/attendance', {
      workspaceId: ws, userId: ids[who], date: d, checkInTime: at(d, late ? 10 : 8, late ? 25 : 40), checkOutTime: at(d, 18),
      workHours: late ? 7.5 : 8.5, status: late ? 'LATE' : 'PRESENT', lateMinutes: late ? 85 : 0, location: 'Office',
    }));
  }
}
if (isWeekday(day(0))) for (const who of ['SOFTWARE_DEVELOPER', 'TESTER', 'MANAGER']) await ok(`check in ${who}`, () => api(jars[who], 'POST', '/attendance/check-in', { workspaceId: ws }));
await ok('holiday', () => api(MGR, 'POST', '/holidays', { workspaceId: ws, name: 'Company Foundation Day', date: nextWeekday(12), description: 'Office closed' }));
await ok('holiday 2', () => api(MGR, 'POST', '/holidays', { workspaceId: ws, name: 'Winter Break', date: `${new Date().getUTCFullYear()}-12-25`, description: 'Office closed' }));

// ---- files ---------------------------------------------------------------------------------
async function upload(jar, project, file, type) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(`${FIXTURES}/${file}`)], { type }), file);
  form.append('workspaceId', ws); form.append('projectId', project.id);
  const res = await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: form });
  if (res.status < 300) made += 1; else problems.push(`upload ${file}: ${res.status}`);
}
if (ecom) { await upload(jars.CONTENT_ENGINEER, ecom, 'logo.svg', 'image/svg+xml'); await upload(jars.CONTENT_ENGINEER, ecom, 'mockup.jpg', 'image/jpeg'); }

// ---- a few notifications for the bell ---------------------------------------------------------
for (const [who, title, message] of [
  ['SOFTWARE_DEVELOPER', 'You were assigned a task', 'Card payment form with 3-D Secure is now yours.'],
  ['TESTER', 'Task moved to Review', 'Order confirmation e-mail template is ready for your pass.'],
  ['MANAGER', 'Sprint ends in 7 days', 'Sprint 2 — Checkout finishes next week.'],
]) await ok('notification', () => api(admin, 'POST', '/notifications', { workspaceId: ws, userId: ids[who], type: 'general', title, message }));

console.log(`\ncreated ${made} records in "${NAME}" (${ws}); ${problems.length} call(s) failed`);
for (const p of problems.slice(0, 25)) console.log('  ! ' + p);
}

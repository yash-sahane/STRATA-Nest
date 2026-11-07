// An archived project is read-only, and a copy of a project starts on its own day —
// checked against the running stack.
//
//  - Archiving a project used to change one word on it and nothing else: its tasks,
//    sprints, requirements, epics, comments and time all stayed exactly as editable.
//    While it is archived every change into it is refused (400, "This project is
//    archived. Unarchive it to make changes."), by every route, and the screens stop
//    offering one. Reading it, copying it, deleting it and un-archiving it still work;
//    a timer already running on its work can still be stopped; an edge from an open
//    task onto its work can still be taken off; and its leftovers drop off the team's
//    workload.
//  - A clone used to carry every date unchanged, so last year's project copied into a
//    new one that was late on the day it was made. Every copied date now moves by the
//    days from the source's start to the copy's.
import { api, adminJar, provision, addRole, whoami, recorder, chromium, signedInPage, visit } from './kit.mjs';

const { rec, summary } = recorder();
const brief = (r) => `${r.s} ${String(r.t).slice(0, 200)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const refused = (r) => r.s === 400 && /archived/i.test(String(r.t));

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const admin = await adminJar();
const p = await provision('archived');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);
const made = [];

/** The workload row the Team page reads for one person. */
const loadOf = async (userId) =>
  ((await api(mgr, 'GET', `/tasks/summary?workspaceId=${p.ws}`)).j?.byAssignee ?? []).find(
    (row) => row.userId === userId,
  )?.totalTasks ?? 0;

try {
  // ---- a project with some of everything in it ------------------------------------------
  console.log('===== a project with work in it');
  const P = p.project;
  await api(admin, 'PATCH', `/projects/${P}`, { startDate: '2026-01-05', endDate: '2026-03-31' });
  const sprint = (await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws, projectId: P, name: 'Sprint One', startDate: '2026-01-05', endDate: '2026-01-18',
  })).j?.id;
  const epic = (await api(mgr, 'POST', '/epics', {
    workspaceId: p.ws, projectId: P, name: 'Checkout', startDate: '2026-01-10', endDate: '2026-02-01',
  })).j?.id;
  const cr = (await api(mgr, 'POST', '/client_requirements', { workspaceId: p.ws, projectId: P, title: 'Payments' })).j?.id;
  const fr = (await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws, projectId: P, title: 'Card payments', clientRequirementId: cr,
  })).j?.id;
  const due = '2026-01-12T18:30:00.000Z';
  const t1 = (await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: P, title: 'Wire the card form', assigneeIds: [devId], dueDate: due,
  })).j?.id;
  const Q = (await api(admin, 'POST', '/projects', { workspaceId: p.ws, name: 'Downstream', shortCode: 'DWN', clientName: 'QA' })).j?.id;
  if (Q) made.push(Q);
  const t2 = (await api(mgr, 'POST', '/tasks', { workspaceId: p.ws, projectId: Q, title: 'Waits on the card form' })).j?.id;
  const edge = await api(mgr, 'POST', `/tasks/${t2}/dependencies`, { targetTaskId: t1, type: 'blockedBy' });
  const comment = await api(dev, 'POST', '/task_comments', { taskId: t1, content: 'Started on it.' });
  rec(Boolean(sprint && epic && cr && fr && t1 && t2) && edge.s < 300 && comment.s < 300,
    'a sprint, an epic, requirements, tasks, a cross-project edge and a comment are made',
    `${sprint} ${epic} ${cr} ${fr} ${t1} ${t2} edge=${brief(edge)} comment=${brief(comment)}`);

  // The developer's own timer, on the work about to be archived.
  for (const timer of list((await api(dev, 'GET', '/active_timers')).j)) {
    await api(dev, 'DELETE', `/active_timers/${timer.id}`);
  }
  const timer = await api(dev, 'POST', '/active_timers/start', { taskId: t1 });
  rec(timer.s < 300, 'a timer runs on one of its tasks', brief(timer));
  const loadBefore = await loadOf(devId);

  // ---- archived ----------------------------------------------------------------------
  console.log('===== archived');
  const archived = await api(mgr, 'PATCH', `/projects/${P}`, { status: 'ARCHIVED' });
  rec(archived.s === 200 && archived.j?.status === 'ARCHIVED', 'the project is archived', brief(archived));

  const attempts = {
    'a new task': () => api(mgr, 'POST', '/tasks', { workspaceId: p.ws, projectId: P, title: 'One more' }),
    'a task edit': () => api(mgr, 'PATCH', `/tasks/${t1}`, { title: 'Renamed' }),
    'a reorder on the board': () => api(mgr, 'PATCH', `/tasks/${t1}`, { position: 5 }),
    'a task deleted': () => api(mgr, 'DELETE', `/tasks/${t1}`),
    'a comment': () => api(dev, 'POST', '/task_comments', { taskId: t1, content: 'Still here?' }),
    'a sprint renamed': () => api(mgr, 'PATCH', `/sprints/${sprint}`, { name: 'Sprint Uno' }),
    'a sprint started': () => api(mgr, 'PATCH', `/sprints/${sprint}`, { status: 'ACTIVE' }),
    'a new sprint': () => api(mgr, 'POST', '/sprints', {
      workspaceId: p.ws, projectId: P, name: 'Sprint Two', startDate: '2026-01-19', endDate: '2026-02-01',
    }),
    'an epic edited': () => api(mgr, 'PATCH', `/epics/${epic}`, { name: 'Checkout v2' }),
    'an epic deleted': () => api(mgr, 'DELETE', `/epics/${epic}`),
    'a client requirement edited': () => api(mgr, 'PATCH', `/client_requirements/${cr}`, { title: 'Payments v2' }),
    'a new functional requirement': () => api(mgr, 'POST', '/functional_requirements', {
      workspaceId: p.ws, projectId: P, title: 'Refunds',
    }),
    'a functional requirement edited': () => api(mgr, 'PATCH', `/functional_requirements/${fr}`, { title: 'Cards' }),
    'an AI plan saved into it': () => api(mgr, 'POST', '/bulk-save', {
      workspaceId: p.ws, projectId: P, generated: { clientRequirements: [{ title: 'Generated' }] },
    }),
    'time logged by hand': () => api(dev, 'POST', '/time_entries', {
      workspaceId: p.ws, taskId: t1,
      startTime: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      endTime: new Date(Date.now() - 60 * 60_000).toISOString(),
    }),
    'a timer switched onto it': () => api(dev, 'POST', '/active_timers/start', { taskId: t1, replace: true }),
    'an edge drawn onto its task': () => api(mgr, 'POST', `/tasks/${t2}/dependencies`, { targetTaskId: t1, type: 'blocks' }),
    'the project renamed': () => api(mgr, 'PATCH', `/projects/${P}`, { name: 'Renamed project' }),
  };
  for (const [what, attempt] of Object.entries(attempts)) {
    const r = await attempt();
    rec(refused(r), `refused while archived: ${what}`, brief(r));
  }

  const tasks = await api(mgr, 'GET', `/tasks?projectId=${P}&limit=50`);
  rec(tasks.s === 200 && list(tasks.j).some((t) => t.id === t1), 'its work can still be read', brief(tasks));
  const unlinked = await api(mgr, 'DELETE', `/tasks/${t2}/dependencies/${t1}?type=blockedBy`);
  const t2After = (await api(mgr, 'GET', `/tasks/${t2}`)).j;
  rec(unlinked.s < 300 && !(t2After?.blockedBy ?? []).includes(t1),
    'an open task can still let go of an edge onto it', `${brief(unlinked)} blockedBy=${JSON.stringify(t2After?.blockedBy)}`);
  const stopped = await api(dev, 'POST', '/active_timers/stop', { workspaceId: p.ws });
  rec(stopped.s < 300, 'the timer that was running can still be stopped', brief(stopped));
  const loadAfter = await loadOf(devId);
  rec(loadBefore >= 1 && loadAfter === loadBefore - 1,
    "its leftovers drop off the assignee's workload", `before ${loadBefore}, after ${loadAfter}`);

  // ---- what the screens offer ------------------------------------------------------------
  console.log('===== the screens of an archived project');
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
    await visit(page, `/tasks?projectId=${P}&scope=all`, 6000);
    const banner = await page.getByText('Archived — read-only').count();
    const newTask = await page.getByRole('button', { name: 'New Task' }).count();
    rec(banner > 0 && newTask === 0, 'the tasks page says it is read-only and offers no New Task', `banner ${banner}, New Task ${newTask}`);
    await visit(page, `/projects/${P}/settings`, 6000);
    const nameLocked = await page.locator('#name').isDisabled().catch(() => null);
    const statusOpen = await page.locator('#status').isEnabled().catch(() => null);
    rec(nameLocked === true && statusOpen === true,
      'its settings take a status change and nothing else', `name disabled ${nameLocked}, status enabled ${statusOpen}`);
    await ctx.close();
  } finally {
    await browser.close();
  }

  // ---- copied: a new plan, on its own day --------------------------------------------------
  console.log('===== a copy of it starts on its own day');
  const startDay = '2027-03-01';
  const moved = daysBetween('2026-01-05', startDay);
  const copy = await api(admin, 'POST', `/projects/${P}/clone`, {
    name: 'Archived, copied', includeTasks: true, includeSprints: true, startDate: startDay,
  });
  if (copy.j?.id) made.push(copy.j.id);
  rec(copy.s === 201 && copy.j?.status === 'PLANNING' && copy.j?.startDate === startDay,
    'an archived project is copied into a new one in Planning, starting on the day asked', brief(copy));
  rec(copy.j?.copied?.daysMoved === moved, 'the copy says how far its dates moved', `${copy.j?.copied?.daysMoved} vs ${moved}`);
  const copiedSprint = list((await api(admin, 'GET', `/sprints?projectId=${copy.j?.id}&limit=10`)).j)[0];
  rec(copiedSprint?.startDate === startDay && copiedSprint?.endDate === '2027-03-14' && copiedSprint?.status === 'PLANNING',
    'its sprint keeps its length, from the new start', JSON.stringify(copiedSprint && { s: copiedSprint.startDate, e: copiedSprint.endDate, st: copiedSprint.status }));
  const copiedEpic = list((await api(admin, 'GET', `/epics?projectId=${copy.j?.id}&limit=10`)).j)[0];
  rec(copiedEpic?.startDate === '2027-03-06', 'its epic is as far from the start as it was', copiedEpic?.startDate);
  const copiedTask = list((await api(admin, 'GET', `/tasks?projectId=${copy.j?.id}&limit=10`)).j)[0];
  rec(copiedTask && Date.parse(copiedTask.dueDate) === Date.parse(due) + moved * DAY,
    'its due date moves by the same days, at the same time of day', `${copiedTask?.dueDate}`);

  // ---- un-archived, and gone ---------------------------------------------------------------
  console.log('===== un-archived, and deleted');
  const unarchived = await api(mgr, 'PATCH', `/projects/${P}`, { status: 'ACTIVE', name: 'Back in play' });
  rec(unarchived.s === 200 && unarchived.j?.status === 'ACTIVE' && unarchived.j?.name === 'Back in play',
    'un-archiving takes the rest of the form with it', brief(unarchived));
  const editedAgain = await api(mgr, 'PATCH', `/tasks/${t1}`, { title: 'Wire the card form, again' });
  rec(editedAgain.s === 200, 'and its work takes changes again', brief(editedAgain));
  // ---- a running sprint is finished first -------------------------------------------------
  // Archiving froze a running sprint as it was: it read "Active" (later "Overdue") for good,
  // with no way left to complete it.
  console.log('===== a project with a sprint still running');
  const running = (await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws, projectId: Q, name: 'Still running', startDate: '2026-11-02', endDate: '2026-11-13',
  })).j?.id;
  const started = await api(mgr, 'PATCH', `/sprints/${running}`, { status: 'ACTIVE' });
  rec(started.s === 200, 'a sprint is running in the project', brief(started));
  const tooSoon = await api(mgr, 'PATCH', `/projects/${Q}`, { status: 'ARCHIVED' });
  rec(tooSoon.s === 400 && /Still running.*Complete it before archiving/.test(tooSoon.t),
    'archiving it is refused, naming the sprint to complete first', brief(tooSoon));
  const stillOpen = (await api(mgr, 'GET', `/projects/${Q}`)).j;
  rec(stillOpen?.status !== 'ARCHIVED', 'and the project is left as it was', stillOpen?.status);
  const finished = await api(mgr, 'POST', `/sprints/${running}/complete`, {});
  rec(finished.s < 300, 'the sprint is completed', brief(finished));
  const archivedNow = await api(mgr, 'PATCH', `/projects/${Q}`, { status: 'ARCHIVED' });
  rec(archivedNow.s === 200 && archivedNow.j?.status === 'ARCHIVED', 'then the project archives', brief(archivedNow));

  const gone = await api(admin, 'DELETE', `/projects/${Q}`);
  if (gone.s === 204) made.splice(made.indexOf(Q), 1);
  rec(gone.s === 204, 'an archived project can still be deleted', brief(gone));
} finally {
  for (const project of made) await api(admin, 'DELETE', `/projects/${project}`);
  await p.cleanup();
}

const rows = summary();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

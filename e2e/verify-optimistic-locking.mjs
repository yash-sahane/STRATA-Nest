// Two people editing one record. Is the second save refused when it should be, and
// LET THROUGH when it should be?
//
// The measured failure this exists to hold shut: B set a task's priority to CRITICAL
// while A had the edit dialog open; A saved a new title and priority went back to LOW,
// with a success toast for A and nothing at all for B.
//
// The check the API does is per FIELD — `basedOn` carries what the editor believed the
// fields they are writing held — and both halves of that are load-bearing:
//
//   refuse   two people editing the SAME field. Otherwise the later save wins outright
//            and the earlier person's work is gone with nothing said to either of them.
//   allow    two people editing DIFFERENT fields. This is the ordinary case — one
//            retitles a task while another reprioritises it — and a row-level version
//            counter refuses it too, sending somebody away to redo work that clashed
//            with nothing. Measured: that regression is what made this per-field.
//
// Plus the three things such a check gets wrong in practice, each measured rather than
// assumed: a value that is merely rendered differently (a date), a background writer
// that moves the row without a human touching it, and a save that carries no baseline.
import { api, provision, addRole, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();
const p = await provision('locking');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');

const mgrId = await whoami(mgr);

/** A fresh task, as the API renders it. `hierarchyId` is required on create. */
let seq = 0;
async function newTask(title, extra = {}) {
  seq += 1;
  const r = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws,
    projectId: p.project,
    hierarchyId: `LOCK-${seq}`,
    title,
    priority: 'LOW',
    createdBy: mgrId,
    ...extra,
  });
  if (r.s !== 201 && r.s !== 200) throw new Error(`could not create a task: ${r.s} ${r.t}`);
  return r.j;
}

const read = async (jar, path) => (await api(jar, 'GET', path)).j;

// -------------------------------------------- the same field: refused, and nothing lost

{
  const t = await newTask('both of us will edit the priority');

  // Both open it. This is the moment two edit dialogs are on screen.
  const a = await read(mgr, `/tasks/${t.id}`);
  const b = await read(dev, `/tasks/${t.id}`);

  const first = await api(dev, 'PATCH', `/tasks/${t.id}`, {
    priority: 'CRITICAL',
    basedOn: { priority: b.priority },
  });
  rec(first.s === 200, "the first person's save is accepted", `status ${first.s} ${first.t}`);

  // A saves the same field, still holding the value from before B's write.
  const second = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    priority: 'LOW',
    basedOn: { priority: a.priority },
  });
  rec(
    second.s === 409,
    'the second person is refused rather than silently winning',
    `status ${second.s} — a 200 here IS the lost update`,
  );
  rec(
    second.j?.error?.type === 'ChangedWhileEditing',
    'the refusal is labelled so a client can word it properly',
    `type=${second.j?.error?.type}`,
  );
  const msg = String(second.j?.error?.message ?? '');
  rec(
    /changed the priority/i.test(msg),
    'the refusal names the field that clashed',
    JSON.stringify(msg),
  );
  rec(
    /reload/i.test(msg),
    'and says what to do about it',
    JSON.stringify(msg),
  );

  const after = await read(mgr, `/tasks/${t.id}`);
  rec(
    after.priority === 'CRITICAL',
    "the first person's work survives",
    `priority is ${after.priority} — LOW means the refusal did not stop the write`,
  );
}

// ------------------------------------- a different field: no conflict, nobody disturbed

{
  const t = await newTask('one of us retitles, the other reprioritises');
  const a = await read(mgr, `/tasks/${t.id}`);

  // B changes the priority.
  const first = await api(dev, 'PATCH', `/tasks/${t.id}`, {
    priority: 'CRITICAL',
    basedOn: { priority: a.priority },
  });
  rec(first.s === 200, 'the priority change lands', `status ${first.s}`);

  // A changes only the title, on a snapshot taken before that.
  const second = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    title: 'renamed by the other person',
    basedOn: { title: a.title },
  });
  rec(
    second.s === 200,
    'a save to a DIFFERENT field is not refused',
    `status ${second.s} — a 409 here is the row-level check this design exists to avoid`,
  );

  const after = await read(mgr, `/tasks/${t.id}`);
  rec(
    after.title === 'renamed by the other person' && after.priority === 'CRITICAL',
    'and both changes are in the record',
    `title=${JSON.stringify(after.title)} priority=${after.priority}`,
  );
}

// ------------------------------------ a baseline for a field the save is not writing

{
  const t = await newTask('the client sent more baseline than it is writing');
  const a = await read(mgr, `/tasks/${t.id}`);
  await api(dev, 'PATCH', `/tasks/${t.id}`, {
    priority: 'CRITICAL',
    basedOn: { priority: a.priority },
  });

  // Writing the title only, but the baseline also mentions priority — which HAS moved.
  const save = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    title: 'still fine',
    basedOn: { title: a.title, priority: a.priority },
  });
  rec(
    save.s === 200,
    'a baseline entry for a field not being written is ignored',
    `status ${save.s} — otherwise the check is row-level wearing a disguise`,
  );
}

// ---------------------------------------------- values the API renders back differently

{
  const due = '2026-11-05T09:00:00.000Z';
  const t = await newTask('a date is not stored the way it is shown', { dueDate: due });
  const a = await read(mgr, `/tasks/${t.id}`);
  // The response carries microsecond precision; the row holds an instant. If those two
  // are compared raw, EVERY save carrying a date is refused for a change nobody made.
  const save = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    dueDate: '2026-12-01T09:00:00.000Z',
    basedOn: { dueDate: a.dueDate },
  });
  rec(
    save.s === 200,
    'a date baseline matches although the two sides render it differently',
    `status ${save.s} ${String(save.t).slice(0, 160)}`,
  );

  // And a date somebody else really did change is still caught.
  const b = await read(dev, `/tasks/${t.id}`);
  await api(dev, 'PATCH', `/tasks/${t.id}`, {
    dueDate: '2027-01-15T09:00:00.000Z',
    basedOn: { dueDate: b.dueDate },
  });
  const clash = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    dueDate: '2027-02-02T09:00:00.000Z',
    basedOn: { dueDate: b.dueDate },
  });
  rec(
    clash.s === 409,
    'and a date somebody else really changed is still caught',
    `status ${clash.s} — 200 means the date comparison passes everything`,
  );
}

// ----------------------------------------------------- an empty field is one absence

{
  const t = await newTask('nothing in the description');
  // The row has '' and the client may hold null or undefined for the same nothing.
  const save = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    description: 'writing one now',
    basedOn: { description: null },
  });
  rec(
    save.s === 200,
    'null, undefined and empty string are one absence, not three values',
    `status ${save.s} — otherwise every never-set field reads as a conflict`,
  );
}

// ------------------------------------------------ an empty list is the same absence

{
  const t = await newTask('nobody is assigned to me');
  // The row holds `[]`; a client that never had a value for the field sends null. Read as
  // different, every unassigned record would refuse the first save made to it.
  const save = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    assigneeIds: [mgrId],
    basedOn: { assigneeIds: null },
  });
  rec(
    save.s === 200,
    'an empty list and no value at all are one absence',
    `status ${save.s} — a 409 here refuses the first assignment of every unassigned record`,
  );

  // And a list somebody else really did fill is still caught.
  const b = await read(dev, `/tasks/${t.id}`);
  await api(dev, 'PATCH', `/tasks/${t.id}`, {
    assigneeIds: [],
    basedOn: { assigneeIds: b.assigneeIds },
  });
  const clash = await api(mgr, 'PATCH', `/tasks/${t.id}`, {
    assigneeIds: [mgrId],
    basedOn: { assigneeIds: b.assigneeIds },
  });
  rec(
    clash.s === 409,
    'and a list somebody else really changed is still caught',
    `status ${clash.s} — 200 means the list comparison passes everything`,
  );
}

// ------------------------------------------------------- a client that sends no baseline

{
  const t = await newTask('an older client');
  const r = await api(mgr, 'PATCH', `/tasks/${t.id}`, { title: 'saved without a baseline' });
  rec(r.s === 200, 'a save with no basedOn still applies', `status ${r.s} ${r.t}`);
}

// ---------------------------------------------- the other collections behave the same

{
  const cr = (await api(mgr, 'POST', '/client_requirements', {
    workspaceId: p.ws,
    projectId: p.project,
    title: 'Requirement under two editors',
    description: 'seed',
  })).j;
  const epic = (await api(mgr, 'POST', '/epics', {
    workspaceId: p.ws,
    projectId: p.project,
    hierarchyId: 'LOCK-EP',
    name: 'Epic under two editors',
  })).j;
  const sprint = (await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws,
    projectId: p.project,
    name: 'Sprint under two editors',
    startDate: '2026-10-01',
    endDate: '2026-10-14',
  })).j;
  const fr = (await api(mgr, 'POST', '/functional_requirements', {
    workspaceId: p.ws,
    projectId: p.project,
    hierarchyId: 'LOCK-FR',
    title: 'Functional requirement under two editors',
    description: 'seed',
  })).j;
  const project = (await api(p.admin, 'GET', `/projects/${p.project}`)).j;

  // [label, path, the row as loaded, the clashing field, a second untouched field]
  const cases = [
    ['client requirement', `/client_requirements/${cr?.id}`, cr, 'title', 'description'],
    ['functional requirement', `/functional_requirements/${fr?.id}`, fr, 'title', 'description'],
    ['epic', `/epics/${epic?.id}`, epic, 'name', 'description'],
    ['sprint', `/sprints/${sprint?.id}`, sprint, 'goal', 'name'],
    ['project', `/projects/${p.project}`, project, 'description', 'name'],
  ];

  for (const [label, path, row, clashField, otherField] of cases) {
    if (!row) {
      rec(false, `${label} could be created`, 'nothing came back from the create');
      continue;
    }
    // Projects are edited by managers and admins; use the admin jar for that one so a
    // permission answer can never be mistaken for a conflict answer.
    const jar = label === 'project' ? p.admin : mgr;
    const before = { [clashField]: row[clashField], [otherField]: row[otherField] };

    const first = await api(jar, 'PATCH', path, {
      [clashField]: 'theirs',
      basedOn: { [clashField]: before[clashField] },
    });
    rec(first.s === 200, `${label}: the first save lands`, `status ${first.s} ${first.t}`);

    const clash = await api(jar, 'PATCH', path, {
      [clashField]: 'mine',
      basedOn: { [clashField]: before[clashField] },
    });
    rec(
      clash.s === 409 && clash.j?.error?.type === 'ChangedWhileEditing',
      `${label}: a save to the field they changed is refused`,
      `status ${clash.s}, type ${clash.j?.error?.type}`,
    );

    const disjoint = await api(jar, 'PATCH', path, {
      [otherField]: 'mine, elsewhere',
      basedOn: { [otherField]: before[otherField] },
    });
    rec(
      disjoint.s === 200,
      `${label}: a save to a field they did not touch goes through`,
      `status ${disjoint.s} ${String(disjoint.t).slice(0, 160)}`,
    );
  }
}

// ------------------------------------------ completing a sprint must not fake a conflict
//
// The reason this is a version COLUMN and not `updated_at`. SprintCompletedTaskRoller
// detaches every incomplete task when a sprint completes. On `updated_at` that would
// bump every one of those rows, and the next person to save any of them would be told
// somebody else had edited it — about a change no human made and none of them can see.
// A false conflict on a routine workflow is worse than the bug being fixed, so it gets
// measured rather than assumed.
{
  const sprint = (await api(mgr, 'POST', '/sprints', {
    workspaceId: p.ws,
    projectId: p.project,
    name: 'Sprint that will be completed',
    startDate: '2026-10-01',
    endDate: '2026-10-14',
  })).j;

  const inSprint = await newTask('unfinished when the sprint ends', { sprintId: sprint.id });
  const loaded = await read(mgr, `/tasks/${inSprint.id}`);

  await api(mgr, 'PATCH', `/sprints/${sprint.id}`, { status: 'ACTIVE' });
  const completed = await api(mgr, 'POST', `/sprints/${sprint.id}/complete`, {});
  rec(
    completed.s === 200 || completed.s === 201,
    'the sprint completes',
    `status ${completed.s} ${completed.t}`.slice(0, 200),
  );

  const rolled = await read(mgr, `/tasks/${inSprint.id}`);
  rec(
    rolled?.sprintId === '' || rolled?.sprintId == null,
    'the unfinished task was actually rolled out of the sprint',
    `sprintId=${JSON.stringify(rolled?.sprintId)} — if it was not, the next check proves nothing`,
  );

  const save = await api(mgr, 'PATCH', `/tasks/${inSprint.id}`, {
    title: 'edited after the sprint ended',
    basedOn: { title: loaded.title },
  });
  rec(
    save.s === 200,
    'somebody editing that task afterwards is NOT told there was a conflict',
    `status ${save.s} — a 409 here is the spurious conflict this design avoids`,
  );
}

const rows = summary();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

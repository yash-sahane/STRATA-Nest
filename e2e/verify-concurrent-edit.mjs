// Two people editing the same task. Does either of them lose work silently?
//
// Nothing has tested this, and the shape is the dangerous one:
//
//   the server   ScopedCrudService.update does `prisma.update({ where: { id }, data })`
//                — no version column, no If-Match, no conflict detection. Last write wins.
//   the client   handleEditTask sends the WHOLE form every time — title, description,
//                status, priority, dueDate, estimatedHours — not just what changed.
//
// Together those mean a save can carry values that were already stale when the dialog
// opened, and overwrite somebody else's change to a field the saver never touched. No
// error, no warning, no trace: the other person's edit is simply gone.
//
// The edit dialog re-seeds from its prop while `hasChanges` is false, so a background
// refetch does rescue the untouched case. The moment the first key is pressed that guard
// stops re-seeding — deliberately, to protect the edit in progress — and from then on
// every other field in the form is a snapshot of when it opened. That is the path tested
// here, because it is the one a real edit takes.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('concur');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const until = async (page, fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'CE-1',
  title: 'Shared task', status: 'TODO', priority: 'LOW', assigneeIds: [mgrId],
  description: 'Both people can see this.',
});
rec(task.s === 201, 'a task exists for two people to edit', `${task.s} ${task.t.slice(0, 160)}`);
const taskId = task.j?.id;

const readTask = async () => (await api(mgr, 'GET', `/tasks/${taskId}`)).j;
const before = await readTask();
console.log(`   initial: priority=${before?.priority} status=${before?.status} title=${JSON.stringify(before?.title)}`);

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, `/tasks?taskId=${taskId}`, 9000);

// ---- person A opens the edit dialog -----------------------------------------
console.log('\n===== A opens the task and starts editing the TITLE');
{
  // From the details dialog, into edit.
  const editBtn = page.locator('[role="dialog"]:visible').getByRole('button', { name: /^Edit$/ }).first();
  const haveEdit = await until(page, async () => (await editBtn.count()) > 0 ? true : null, 15000);
  rec(Boolean(haveEdit), 'A can open the edit dialog', String(await editBtn.count()));
  if (!haveEdit) {
    await ctx.close(); await browser.close(); await p.cleanup();
    throw new Error('no edit control — cannot run the concurrency check');
  }
  await editBtn.click();
  await page.waitForTimeout(2500);

  const dialog = page.locator('[role="dialog"]:visible').first();
  const titleInput = dialog.locator('#title, input[name="title"]').first();
  rec(await titleInput.count() > 0, 'the edit form is showing the task', String(await titleInput.count()));

  // A types. This is the moment `hasChanges` flips and the form stops re-seeding.
  await titleInput.fill('Title edited by A');
  await page.waitForTimeout(500);
  console.log('   A has typed a new title; the form now holds a snapshot of every other field');

  // ---- meanwhile, B changes a DIFFERENT field ------------------------------
  console.log('\n===== meanwhile B changes the PRIORITY, a field A never touched');
  const bEdit = await api(mgr, 'PATCH', `/tasks/${taskId}`, { priority: 'CRITICAL' });
  rec(bEdit.s < 400, "B's change is accepted", `${bEdit.s} ${bEdit.t.slice(0, 160)}`);
  const afterB = await readTask();
  console.log(`   after B: priority=${afterB?.priority} title=${JSON.stringify(afterB?.title)}`);
  rec(afterB?.priority === 'CRITICAL', "B's priority change landed", String(afterB?.priority));

  // Give any background refetch time to arrive. It must NOT re-seed the form now,
  // because A has unsaved typing — that guard is correct and is what makes the
  // stale snapshot possible.
  await page.waitForTimeout(4000);

  // ---- A saves ------------------------------------------------------------
  console.log('\n===== A saves, having changed only the title');
  const save = dialog.getByRole('button', { name: /save|update/i }).last();
  rec(await save.count() > 0, 'the edit dialog offers Save', String(await save.count()));
  await save.click();

  const saved = await until(page, async () => {
    const t = await readTask();
    return t?.title === 'Title edited by A' ? t : null;
  }, 20000);
  rec(Boolean(saved), "A's title change was saved", saved ? '' : 'the title never changed');

  const finalTask = await readTask();
  console.log(`   final: priority=${finalTask?.priority} title=${JSON.stringify(finalTask?.title)}`);

  // THE question.
  rec(finalTask?.priority === 'CRITICAL',
    "and B's priority change SURVIVED A's save",
    `priority is ${finalTask?.priority}, was CRITICAL before A saved — A's form carried a stale `
    + `priority from when the dialog opened and overwrote it. No error was shown to either person.`);

  // What did the request actually carry? Proving the mechanism, not just the symptom.
  console.log('\n===== what A\'s save actually sent');
  const sent = await page.evaluate(() => window.__lastPatchBody ?? null);
  if (sent) console.log(`   PATCH body: ${JSON.stringify(sent).slice(0, 300)}`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

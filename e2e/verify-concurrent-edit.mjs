// Two people editing the same task, through the real dialog. Two outcomes, both required.
//
// The shape that made this dangerous:
//
//   the server   ScopedCrudService.update was `prisma.update({ where: { id }, data })`
//                — no version column, no If-Match, no conflict detection. Last write won.
//   the client   handleEditTask sent the WHOLE form every time — title, description,
//                status, priority, dueDate, estimatedHours — not just what changed.
//
// Together those meant a save carried values that were already stale when the dialog
// opened and overwrote somebody else's change to a field the saver never touched. No
// error, no warning, no trace: the other person's edit was simply gone.
//
// The edit dialog re-seeds from its prop while `hasChanges` is false, so a background
// refetch does rescue the untouched case. The moment the first key is pressed that guard
// stops re-seeding — deliberately, to protect the edit in progress — and from then on
// every other field in the form is a snapshot of when it opened. That is the path driven
// here, because it is the one a real edit takes.
//
// DIFFERENT fields (part one): both saves land, and neither person is interrupted. This
// is the ordinary case and the reason the API's check is per field rather than per row —
// a row-level version counter refuses this too, and sends somebody away to redo work
// that clashed with nothing.
//
// The SAME field (part two): the save is refused, and refused USABLY — a message naming
// the field, and every word still in the form. A conflict that clears the box has taken
// the work it was supposed to protect.
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
console.log('\n===== part one: DIFFERENT fields. A edits the title...');
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

// ---- part two: the SAME field -----------------------------------------------
//
// The case the diff cannot cover. Both people change the title; the second save must be
// refused rather than winning — and the refusal has to leave the person somewhere they
// can act from, which means their typing is still in the box.
console.log('\n===== part two: the SAME field. Both of us retitle it.');
{
  await visit(page, `/tasks?taskId=${taskId}`, 9000);
  const editBtn = page.locator('[role="dialog"]:visible').getByRole('button', { name: /^Edit$/ }).first();
  const haveEdit = await until(page, async () => ((await editBtn.count()) > 0 ? true : null), 15000);
  rec(Boolean(haveEdit), 'A can reopen the edit dialog', String(await editBtn.count()));
  if (haveEdit) {
    await editBtn.click();
    await page.waitForTimeout(2500);

    const dialog = page.locator('[role="dialog"]:visible').first();
    const titleInput = dialog.locator('#title, input[name="title"]').first();
    const TYPED = 'A spent a while writing this one';
    await titleInput.fill(TYPED);
    await page.waitForTimeout(500);

    // B retitles it first — the same field A is holding.
    const bEdit = await api(mgr, 'PATCH', `/tasks/${taskId}`, { title: 'B got there first' });
    rec(bEdit.s < 400, "B's title change is accepted", `${bEdit.s} ${bEdit.t.slice(0, 160)}`);
    await page.waitForTimeout(4000);

    const save = dialog.getByRole('button', { name: /save|update/i }).last();
    await save.click();
    await page.waitForTimeout(4000);

    const after = await readTask();
    rec(
      after?.title === 'B got there first',
      "B's title survives — A's save did not overwrite it",
      `title is ${JSON.stringify(after?.title)}`,
    );

    // The dialog must still be open, still holding what A typed. This is the half a
    // conflict check is easy to get wrong: refusing the write and clearing the form
    // loses exactly the work the refusal existed to protect.
    const stillOpen = await dialog.count();
    rec(stillOpen > 0, 'the dialog stays open after the refusal', `visible dialogs: ${stillOpen}`);
    const held = stillOpen > 0 ? await titleInput.inputValue().catch(() => '') : '';
    rec(
      held === TYPED,
      "and still holds every word A typed",
      `the box reads ${JSON.stringify(held)}, A typed ${JSON.stringify(TYPED)}`,
    );

    // And A is told what happened, in words that name the field.
    const text = await page.evaluate(() => document.body.innerText);
    rec(
      /somebody else changed the title/i.test(text),
      'A is told which field somebody else changed',
      `nothing on the page says so; body text contains ${JSON.stringify(
        (text.match(/[^\n]*(changed|conflict|not been applied)[^\n]*/i) || ['<no such line>'])[0],
      )}`,
    );
    rec(
      /reload/i.test(text),
      'and what to do about it',
      'no instruction shown alongside the refusal',
    );
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

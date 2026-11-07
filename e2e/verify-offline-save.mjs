// What happens if the connection drops while somebody is saving?
//
// Nothing in the suite had tested this, and it is not an exotic case — it is a train, a
// lift, hotel wifi, a laptop waking up. The failure modes that matter are the quiet ones:
//
//   claiming success   the dialog closes, a green toast appears, and the edit is gone.
//                      Worse than an error, because nobody retypes work they were told
//                      was saved.
//   losing the input   the dialog closes on failure and the typing goes with it.
//   losing the write   the connection comes back and the save is simply forgotten.
//
// MEASURED BEHAVIOUR, which is better than expected: the request stays pending while the
// connection is gone, and completes when it returns. Nothing is lost and nothing is
// claimed falsely. The dialog closes at that point because the save genuinely succeeded.
//
// The one real gap is the last check here: for as long as the connection is away the
// button reads "Saving..." and nothing says why. If it never comes back, that spinner is
// for ever.
//
// A NOTE ON HOW THIS CHECK WAS WRONG FIRST TIME, because the mistake is instructive. It
// asserted "the app says the save failed, in words about the connection" by grepping the
// whole page body for /connect|network|offline/ — and passed, because the title being
// typed into the form was "Retitled with no connection". The assertion matched the test's
// own data. Anything searching a page for words must search where those words would
// actually appear, and must not use vocabulary the fixture shares.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, recorder } from './kit.mjs';

const { rec, summary } = recorder();

const browser = await chromium.launch();
const p = await provision('offline');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// Deliberately free of the words this check looks for later.
const TYPED = 'Retitled midway through a save';

const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws,
  projectId: p.project,
  hierarchyId: 'OFF-1',
  title: 'Original title',
  status: 'TODO',
  priority: 'LOW',
  assigneeIds: [mgrId],
  description: 'Present before the connection goes.',
});
rec(task.s === 201, 'a task exists to edit', `${task.s} ${task.t.slice(0, 160)}`);
const taskId = task.j?.id;

const readTask = async () => (await api(mgr, 'GET', `/tasks/${taskId}`)).j;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, `/tasks?taskId=${taskId}`, 9000);

const editBtn = page
  .locator('[role="dialog"]:visible')
  .getByRole('button', { name: /^Edit$/ })
  .first();
const haveEdit = await (async () => {
  for (let i = 0; i < 40; i += 1) {
    if ((await editBtn.count()) > 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
})();
rec(haveEdit, 'the edit dialog can be opened', `found ${await editBtn.count()} Edit controls`);

if (haveEdit) {
  await editBtn.click();
  await page.waitForTimeout(2500);

  const dialog = page.locator('[role="dialog"]:visible').first();
  const titleInput = dialog.locator('#title, input[name="title"]').first();
  await titleInput.fill(TYPED);
  await page.waitForTimeout(400);

  // ---- pull the plug ---------------------------------------------------------
  console.log('\n===== the connection drops, and they press Save');
  await ctx.setOffline(true);

  await dialog.getByRole('button', { name: /save|update/i }).last().click();
  await page.waitForTimeout(9000);

  const stored = await readTask();
  rec(
    stored?.title !== TYPED,
    'the edit has not reached the server (it could not have)',
    `stored title is ${JSON.stringify(stored?.title)} — if this matched, the premise of ` +
      'this whole check is wrong',
  );

  // 1. It must not claim success. Scoped to the toast region, not the whole page: the
  //    form contains the text being saved, so a body-wide search reads its own fixture.
  const toastText = await page
    .locator('[data-sonner-toast], [role="status"], [role="alert"]')
    .allInnerTexts()
    .catch(() => []);
  rec(
    !toastText.some((t) => /saved|updated successfully|success/i.test(t)),
    'the app does not claim the save succeeded',
    `toasts on screen: ${JSON.stringify(toastText)} — a success message here is the worst ` +
      'outcome, because nobody retypes work they were told was saved',
  );

  // 2. The dialog must still be open, holding what was typed.
  const stillOpen = await dialog.count();
  rec(stillOpen > 0, 'the dialog stays open while the save is in flight', `dialogs: ${stillOpen}`);
  const held = stillOpen > 0 ? await titleInput.inputValue().catch(() => '') : '';
  rec(
    held === TYPED,
    'and still holds every word that was typed',
    `the box reads ${JSON.stringify(held)}, they typed ${JSON.stringify(TYPED)}`,
  );

  // 3. The write must not be forgotten. This is the one that decides whether any of the
  //    rest mattered.
  console.log('\n===== the connection comes back');
  await ctx.setOffline(false);
  const landed = await (async () => {
    for (let i = 0; i < 60; i += 1) {
      const t = await readTask();
      if (t?.title === TYPED) return true;
      await page.waitForTimeout(500);
    }
    return false;
  })();
  rec(
    landed,
    'the save completes on its own once the connection returns',
    'the title never reached the server — the write was dropped, and the only sign of it ' +
      'was a dialog that closed',
  );

  // The server commits before its answer reaches the browser, so the dialog closes a beat
  // AFTER the write is visible above. Checked once, at once, this failed under full-suite
  // load with the save landed and the dialog about to close — a race in the check, not
  // the app. Wait for the close the way a person would, for a few seconds.
  const closed = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      if ((await page.locator('[role="dialog"]:visible').count()) === 0) return true;
      await page.waitForTimeout(250);
    }
    return false;
  })();
  rec(
    landed && closed,
    'and the dialog closes because it worked, not because it gave up',
    `dialog still open: ${!closed}, save landed: ${landed}`,
  );

  // 4. The gap. While the connection is away the button reads "Saving..." and nothing
  //    says why. A spinner with no explanation is indistinguishable from a hang, and if
  //    the connection never returns it never resolves.
  console.log('\n===== was anything said while the connection was away?');
  const { ctx: ctx2, page: page2 } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page2, `/tasks?taskId=${taskId}`, 9000);
  const edit2 = page2
    .locator('[role="dialog"]:visible')
    .getByRole('button', { name: /^Edit$/ })
    .first();
  for (let i = 0; i < 40 && (await edit2.count()) === 0; i += 1) await page2.waitForTimeout(250);
  if ((await edit2.count()) > 0) {
    await edit2.click();
    await page2.waitForTimeout(2500);
    const d2 = page2.locator('[role="dialog"]:visible').first();
    await d2.locator('#title, input[name="title"]').first().fill('Second edit, also offline');
    await ctx2.setOffline(true);
    await d2.getByRole('button', { name: /save|update/i }).last().click();
    await page2.waitForTimeout(10000);

    const said = await page2
      .locator('[data-sonner-toast], [role="status"], [role="alert"]')
      .allInnerTexts()
      .catch(() => []);
    const offlineNotice = said.some((t) => /offline|connection|internet|reconnect/i.test(t));
    rec(
      offlineNotice,
      'the person is told the connection is the reason nothing is happening',
      `after 10s offline the only things on screen are ${JSON.stringify(said)} and a button ` +
        'reading "Saving...". Nothing is lost and nothing is claimed falsely — but a ' +
        'spinner that never explains itself is indistinguishable from a hang, and if the ' +
        'connection never returns it never resolves',
    );
    await ctx2.setOffline(false);
  }
  await ctx2.close();
}

const rows = summary();
await ctx.close();
await browser.close();
await p.cleanup();
process.exitCode = rows.some((r) => !r.ok) ? 1 : 0;

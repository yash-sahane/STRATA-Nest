// Credential fields a password manager cannot see, focus that goes nowhere, and a
// dialog that remembers what you abandoned.
//
//  the sign-in inputs carried neither `name` nor `autoComplete`, so saving and
//    filling the credential were both unreliable; three of the four password screens
//    were the same (reset-password already did it correctly)
//  pressing Edit on a comment unmounted the focused button and mounted a textarea,
//    leaving focus on nothing
//  Create Epic reset its form on submit and on the Cancel BUTTON only, so Escape, the
//    X and an outside click left the input — and its stale validation error — behind
import { chromium, api, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('affor');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// ---- the sign-in form -------------------------------------------------------
console.log('===== the sign-in form');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      autocomplete: i.autocomplete,
    })),
  );
  console.log(`   ${JSON.stringify(fields)}`);
  const email = fields.find((f) => f.type === 'email');
  const password = fields.find((f) => f.type === 'password');
  rec(Boolean(email && password), 'both credential fields are present', JSON.stringify(fields));
  rec(email?.autocomplete === 'username',
    'the email field is announced as the username', JSON.stringify(email));
  rec(password?.autocomplete === 'current-password',
    'and the password as the CURRENT password, so a manager offers the saved one',
    JSON.stringify(password));
  rec(Boolean(email?.name) && Boolean(password?.name),
    'both carry a name, which a manager keys off',
    JSON.stringify({ email: email?.name, password: password?.name }));
  await ctx.close();
}

// ---- the change-password screen uses new-password ---------------------------
console.log('\n===== the change-password screen');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/change-password', 6000);
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('input')]
      .filter((i) => /password/i.test(i.id))
      .map((i) => ({ id: i.id, autocomplete: i.autocomplete })),
  );
  console.log(`   ${JSON.stringify(fields)}`);
  const current = fields.find((f) => /current/i.test(f.id));
  const next = fields.find((f) => /^newPassword$/i.test(f.id));
  const confirm = fields.find((f) => /confirm/i.test(f.id));
  rec(current?.autocomplete === 'current-password',
    'the existing password is marked current-password', JSON.stringify(current));
  rec(next?.autocomplete === 'new-password' && confirm?.autocomplete === 'new-password',
    'and both new fields new-password, so a manager offers to generate and save rather than overwrite the wrong entry',
    JSON.stringify({ next, confirm }));
  await ctx.close();
}

// ---- focus lands in the comment editor --------------------------------------
console.log('\n===== editing a comment');
{
  const task = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'AF-1',
    title: 'Task with a comment', status: 'TODO', priority: 'MEDIUM', assigneeIds: [mgrId],
  });
  const comment = await api(mgr, 'POST', '/task_comments', {
    taskId: task.j?.id, content: 'The original comment text',
  });
  rec(comment.s === 201, 'a comment exists to edit', `${comment.s} ${comment.t.slice(0, 180)}`);

  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${p.project}&taskId=${task.j.id}`, 9000);

  const edit = page.getByRole('button', { name: /^edit$/i }).first();
  rec(await edit.count() > 0, 'the Edit control is reachable', String(await edit.count()));
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(1500);
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return a
        ? {
            tag: a.tagName.toLowerCase(),
            label: a.getAttribute('aria-label'),
            selectionAtEnd:
              a instanceof HTMLTextAreaElement ? a.selectionStart === a.value.length : null,
            value: a instanceof HTMLTextAreaElement ? a.value : null,
          }
        : null;
    });
    console.log(`   focus after Edit: ${JSON.stringify(focused)}`);
    rec(focused?.tag === 'textarea' && focused?.label === 'Edit comment',
      'focus lands in the edit box rather than nowhere',
      JSON.stringify(focused));
    rec(focused?.selectionAtEnd === true,
      'with the caret at the END of the existing text, so typing appends',
      JSON.stringify(focused));
  }
  await ctx.close();
}

// ---- Create Epic forgets abandoned input ------------------------------------
console.log('\n===== abandoning the Create Epic form');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/epics', 8000);

  const open = page.getByRole('button', { name: /new epic|create epic/i }).first();
  rec(await open.count() > 0, 'the Create Epic button is reachable', String(await open.count()));
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(2500);
    const name = page.locator('input#name, input[name="name"]').first();
    rec(await name.count() > 0, 'the name field is present', String(await name.count()));
    if (await name.count()) {
      await name.fill('Abandoned epic name');
      // Close with ESCAPE — not the Cancel button, which was the only path that reset.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);

      await open.click();
      await page.waitForTimeout(2500);
      const value = await page.locator('input#name, input[name="name"]').first().inputValue();
      console.log(`   the name field after reopening: ${JSON.stringify(value)}`);
      rec(value === '',
        'closing with Escape discards the abandoned input',
        `still held ${JSON.stringify(value)}`);
    }
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

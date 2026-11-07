// A save is checked against what the person was LOOKING AT, not against whatever
// the record has become since.
//
//  The API refuses a save that would overwrite somebody else's change to the same
//  field, given the value the saver believed they were writing over (`basedOn`).
//  Two screens took that value from the wrong place, and one sent none at all:
//
//  - The client requirement dialog read it off the LIVE record at the moment of
//    saving. That record is refetched in the background whenever anybody saves,
//    while the fields stop following it at the first keystroke. So once a
//    colleague's change had arrived, the "baseline" already contained it — the
//    API was told this save was based on their value, and let it replace it.
//
//  - Project settings sent the whole form with no baseline, and re-seeded the
//    form on every refetch. A save wrote this page's copy of the fields nobody
//    here had touched back over what they had since become.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, watchToasts, toasts } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('baseline');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

const until = async (page, fn, ms = 15000, step = 300) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

const requirement = (await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, title: 'Original title',
  description: 'Original description', priority: 'LOW',
})).j;
rec(Boolean(requirement?.id), 'a client requirement exists for two people to edit', JSON.stringify(requirement).slice(0, 160));
const readRequirement = async () => (await api(mgr, 'GET', `/client_requirements/${requirement.id}`)).j;
const readProject = async () => (await api(mgr, 'GET', `/projects/${p.project}`)).j;

const { ctx, page, errors } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

// ---- the client requirement dialog -------------------------------------------
console.log('===== two people change the same title, and the second one is told');
await visit(page, '/requirements', 6000);
await watchToasts(page);
{
  const row = page.locator('tbody tr', { hasText: 'Original title' }).first();
  const listed = await row.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(listed, 'the requirement is listed');
  if (listed) {
    await row.click();
    const dialog = page.getByRole('dialog');
    const title = dialog.getByPlaceholder('Requirement Title');
    const opened = await title.waitFor({ timeout: 15000 }).then(() => true, () => false);
    rec(opened, 'its dialog opens on the title it has', (await dialog.innerText().catch(() => '')).slice(0, 160));
    if (opened) {
      // A starts typing. From here the fields stop following the record.
      await title.fill('Title typed by A');

      // B saves a different title to the same requirement.
      const b = await api(admin, 'PATCH', `/client_requirements/${requirement.id}`, { title: 'Title saved by B' });
      rec(b.s === 200, 'meanwhile a colleague renames it', `${b.s} ${b.t.slice(0, 160)}`);

      // ...and A's browser hears about it: the list behind the dialog redraws.
      // This is the moment the old baseline went wrong — the record under the
      // dialog now holds B's title, while the field still holds A's.
      const arrived = await until(page, async () =>
        (await page.locator('tbody tr', { hasText: 'Title saved by B' }).count()) > 0, 20000);
      rec(Boolean(arrived), "the colleague's change reaches A's browser while the dialog is open",
        'the list never showed the new title, so this run cannot tell the old baseline from the new one');
      await page.waitForTimeout(1500);
      rec((await title.inputValue()) === 'Title typed by A',
        'what A was typing is still in the field', await title.inputValue());

      await dialog.getByRole('button', { name: /save/i }).last().click();
      await page.waitForTimeout(3500);

      const stored = await readRequirement();
      rec(stored?.title === 'Title saved by B',
        "A's save does not replace the colleague's title",
        `the stored title is ${JSON.stringify(stored?.title)}: A's save was let through as if A had seen B's change`);
      const said = (await toasts(page)).join(' | ');
      rec(/title/i.test(said) && /chang|someone|somebody|else/i.test(said),
        'A is told the title was changed by somebody else', said || 'no toast at all');
      rec(await dialog.isVisible() && (await title.inputValue()) === 'Title typed by A',
        'and the dialog stays open with what A typed', await title.inputValue().catch(() => 'dialog closed'));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

// ---- project settings ---------------------------------------------------------
console.log('===== project settings: a save sends what was changed, and nothing else');
await visit(page, `/projects/${p.project}/settings`, 7000);
await watchToasts(page);
{
  const name = page.locator('#name');
  const description = page.locator('#description');
  const ready = await name.waitFor({ timeout: 15000 }).then(() => true, () => false);
  rec(ready, 'the settings form loads', (await page.locator('main').innerText().catch(() => '')).slice(0, 200));
  if (ready) {
    const original = await name.inputValue();

    // B renames the project while A has the page open. Nothing tells this page.
    const b = await api(admin, 'PATCH', `/projects/${p.project}`, { name: 'Renamed by B' });
    rec(b.s === 200, 'a colleague renames the project while the page is open', `${b.s} ${b.t.slice(0, 160)}`);

    await description.fill('Described by A');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    const saved = await until(page, async () => ((await readProject())?.description === 'Described by A'), 15000);
    rec(Boolean(saved), "A's description is saved");
    const after = await readProject();
    rec(after?.name === 'Renamed by B',
      "and the colleague's rename survives it",
      `the name is ${JSON.stringify(after?.name)} — A's form still held ${JSON.stringify(original)} and wrote it back`);

    // The same field, now: A's page still shows the old name.
    console.log('===== and the same field is refused, with the words kept');
    await visit(page, `/projects/${p.project}/settings`, 7000);
    await watchToasts(page);
    await page.locator('#name').waitFor({ timeout: 15000 }).catch(() => {});
    await page.locator('#name').fill('Named by A');
    await api(admin, 'PATCH', `/projects/${p.project}`, { name: 'Renamed by B again' });
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForTimeout(3500);
    const last = await readProject();
    rec(last?.name === 'Renamed by B again',
      "A's rename does not replace one A never saw", `name=${JSON.stringify(last?.name)}`);
    const said = (await toasts(page)).join(' | ');
    rec(/name/i.test(said) && /chang|someone|somebody|else/i.test(said),
      'A is told the name was changed by somebody else', said || 'no toast at all');
    rec((await page.locator('#name').inputValue()) === 'Named by A',
      'and the form keeps what A typed', await page.locator('#name').inputValue());

    // A page that is being edited is not re-seeded under the person editing it.
    console.log('===== a refetch does not wipe an edit in progress');
    await page.locator('#description').fill('Half-typed by A');
    await api(admin, 'PATCH', `/projects/${p.project}`, { clientName: 'Client set by B' });
    // Returning to the tab is what refetches a query that is not live.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(4000);
    rec((await page.locator('#description').inputValue()) === 'Half-typed by A',
      'the description A is in the middle of typing is still there',
      await page.locator('#description').inputValue());
  }
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

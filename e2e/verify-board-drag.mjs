// Dragging a card between columns — does it actually persist?
//
// Nothing in the suite drags anything. Moving a card on the board is how a status is
// changed in normal use, it runs an optimistic update against a server write, and 47
// `tb-*` probes investigated it in an earlier pass — none of which is registered or still
// runs. That combination is exactly what hid the attachment bug.
//
// The attributes are `data-rfd-*`, not `data-rbd-*`: @hello-pangea/dnd renamed them when
// it forked react-beautiful-dnd. Selecting on the old prefix finds nothing and reads as
// "the board rendered no cards", which is what the first run of this reported.
//
// Driven by KEYBOARD rather than synthetic mouse events. @hello-pangea/dnd (a
// react-beautiful-dnd fork) ignores raw mouse dispatches, and its own documented keyboard
// sensor — Space to lift, arrows to move, Space to drop — is both reliable to automate and
// the path a keyboard user actually takes, so one check covers the interaction and its
// accessibility at once.
//
// The question is persistence, not appearance: an optimistic update makes the card move on
// screen whether or not the write succeeded.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('boarddrag');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const mk = async (title, hier) => {
  const r = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: hier,
    title, status: 'TODO', priority: 'MEDIUM', assigneeIds: [mgrId],
  });
  if (r.s !== 201) rec(false, `seeded ${title}`, `${r.s} ${r.t.slice(0, 160)}`);
  return r.j?.id;
};
const dragId = await mk('Card to drag', 'BD-1');
await mk('Second card', 'BD-2');

const readTask = async (id) => (await api(mgr, 'GET', `/tasks/${id}`)).j;

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 20000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

// The board is not behind a toggle: TaskBoard renders directly once a project is
// selected. An earlier version of this clicked `getByRole('button', {name: /board/i})`
// to "switch to it", which matches **Dashboard** in the sidebar — so the run navigated
// away from /tasks and then reported the board as empty.
await visit(page, '/tasks', 9000);

const card = page.locator('[data-rfd-draggable-id]').filter({ hasText: 'Card to drag' }).first();
const present = await until(async () => (await card.count()) > 0 ? true : null, 20000);
if (!present) {
  const diag = await page.evaluate(() => ({
    url: location.pathname + location.search,
    main: (document.querySelector('main')?.innerText || '').trim().slice(0, 200).replace(/\n/g, ' | '),
    droppables: document.querySelectorAll('[data-rfd-droppable-id]').length,
  }));
  console.log(`   diagnostic: ${JSON.stringify(diag)}`);
}
rec(Boolean(present), 'the board renders the card',
  `draggables on screen: ${await page.locator('[data-rfd-draggable-id]').count()} — see the diagnostic above for what the page was actually showing`);

if (!present) {
  await ctx.close(); await browser.close(); await p.cleanup();
  console.log('\ntotal ' + out.length + '  passed ' + out.filter(([o]) => o).length + '  failed ' + out.filter(([o]) => !o).length);
  process.exit(0);
}

const before = await readTask(dragId);
console.log(`   before: status=${before?.status}`);
rec(before?.status === 'TODO', 'the card starts in TODO', String(before?.status));

// ---- the drag, by keyboard --------------------------------------------------
console.log('\n===== lifting the card and moving it one column right');
{
  // The drag handle is the element carrying the rbd handle attribute.
  const handle = page.locator('[data-rfd-drag-handle-draggable-id]')
    .filter({ hasText: 'Card to drag' }).first();
  const haveHandle = await handle.count() > 0;
  rec(haveHandle, 'the card exposes a drag handle', String(await handle.count()));

  if (haveHandle) {
    await handle.focus();
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase(),
      handleFor: document.activeElement?.getAttribute('data-rfd-drag-handle-draggable-id'),
      tabindex: document.activeElement?.getAttribute('tabindex'),
    }));
    console.log(`   focus: ${JSON.stringify(focused)}`);
    rec(Boolean(focused.handleFor), 'the handle takes keyboard focus', JSON.stringify(focused));

    // Space lifts, ArrowRight moves a column, Space drops. rbd's own keyboard sensor.
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const lifted = await page.evaluate(() =>
      Boolean(document.querySelector('[data-rfd-drag-handle-draggable-id][aria-pressed="true"]'))
      || Boolean(document.querySelector('[data-rfd-placeholder-context-id]')));
    console.log(`   lifted: ${lifted}`);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);
  }
}

// ---- did it persist? --------------------------------------------------------
console.log('\n===== what the server now holds');
{
  const moved = await until(async () => {
    const t = await readTask(dragId);
    return t && t.status !== 'TODO' ? t : null;
  }, 15000);

  const after = await readTask(dragId);
  console.log(`   after: status=${after?.status}`);
  rec(Boolean(moved) && after?.status !== 'TODO',
    'the drag PERSISTED: the task left TODO on the server, not just on screen',
    `status is still ${after?.status} — an optimistic update moves the card whether or not `
    + `the write succeeded, so a card in the right place proves nothing on its own`);

  if (after?.status && after.status !== 'TODO') {
    rec(after.status === 'IN_PROGRESS',
      'and landed in the column to its right (IN_PROGRESS)',
      `landed in ${after.status}`);
  }
}

// ---- and it survives a reload ----------------------------------------------
console.log('\n===== after a reload, the card is where it was dropped');
{
  await visit(page, '/tasks', 9000);

  const placed = await until(async () => page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-rfd-draggable-id]'))
      .find((d) => (d.textContent || '').includes('Card to drag'));
    if (!el) return null;
    const column = el.closest('[data-rfd-droppable-id]');
    return column ? column.getAttribute('data-rfd-droppable-id') : null;
  }), 20000);
  console.log(`   the card is rendered in column: ${JSON.stringify(placed)}`);
  const serverStatus = (await readTask(dragId))?.status;
  rec(placed === serverStatus,
    'the board shows it in the column the server says it is in',
    `board=${placed} server=${serverStatus} — a mismatch means the UI and the record disagree`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

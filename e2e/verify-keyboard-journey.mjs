// Can the app be operated without a mouse?
//
// The suite checks that controls can be REACHED and that focus returns in a couple of
// places. It has never tested the things that actually decide whether a keyboard user can
// work: whether Tab escapes an open dialog onto the page behind it, whether focus comes
// back to the control that opened it, whether a nested confirm hands focus back to the
// dialog underneath rather than to <body>, whether the skip link does anything, and
// whether a focused control looks any different from an unfocused one.
//
// axe cannot test any of these. Focus order, focus trapping and focus restoration are
// behaviour over time, not properties of a static tree — which is why 0 violations across
// 18 routes says nothing about them.
//
// dialog.tsx already carries fixes in this area (an explicit opener restore, and a guard
// for presses inside a stacked overlay), so the question is whether they hold, not whether
// anyone thought about it.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 340)}`); };

const browser = await chromium.launch();
const p = await provision('kbd');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'KB-R',
  title: 'Keyboard requirement', clientName: 'Keyboard Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded so the detail dialog has content and a Delete control.',
});

const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'KB-T',
  title: 'Keyboard task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
  description: 'Seeded so the detail dialog has content.',
});

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 12000, step = 200) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

/** A description of whatever currently has focus. */
const focused = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: el ? 'body' : 'none', text: '', inDialog: false };
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
    cls: String(el.className).slice(0, 60),
    inDialog: Boolean(el.closest('[role="dialog"],[role="alertdialog"]')),
    id: el.id || null,
  };
});

// ===========================================================================
// 1. The skip link
// ===========================================================================
console.log('===== the skip link');
{
  await visit(page, '/dashboard', 7000);
  // Focus the very start of the document, then take one Tab.
  await page.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const first = await focused();
  console.log(`   first Tab lands on: ${JSON.stringify(first)}`);
  rec(/skip/i.test(first.text), 'the first Tab stop is the skip link', JSON.stringify(first));

  // It must be VISIBLE while focused, or it is not usable.
  const visible = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: r.width, h: r.height, top: r.top,
      clipped: r.bottom < 0 || r.right < 0,
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    };
  });
  console.log(`   while focused: ${JSON.stringify(visible)}`);
  rec(Boolean(visible) && visible.w > 2 && visible.h > 2 && !visible.clipped
      && visible.visibility !== 'hidden' && visible.display !== 'none',
    'and it becomes visible when focused, rather than staying off-screen',
    JSON.stringify(visible));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const after = await focused();
  console.log(`   after Enter: ${JSON.stringify(after)}`);
  const landedInMain = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return false;
    // Either focus moved into <main>, or the URL fragment points at it.
    return Boolean(el.closest('main')) || el.tagName.toLowerCase() === 'main'
      || location.hash.length > 1;
  });
  rec(landedInMain, 'and following it moves focus into the main content',
    `${JSON.stringify(after)} hash=${await page.evaluate(() => location.hash)}`);
}

// ===========================================================================
// 2. A dialog traps focus, and gives it back
// ===========================================================================
console.log('\n===== a dialog holds focus while it is open');
{
  await visit(page, '/tasks', 8000);
  const opener = page.getByRole('button', { name: /new task|create task/i }).first();
  rec(await opener.count() > 0, 'the create-task opener exists', String(await opener.count()));

  // Remember exactly which element opens it, so restoration can be checked against it.
  await opener.focus();
  const openerDesc = await focused();
  console.log(`   opener: ${JSON.stringify(openerDesc)}`);
  await page.keyboard.press('Enter');
  rec(Boolean(await until(async () =>
    (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 10000)),
    'Enter on the opener opens the dialog (not just a mouse click)', '');

  // Tab well past the number of focusables. If the trap leaks, focus ends up outside.
  let escaped = null;
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focused();
    if (!f.inDialog) { escaped = { at: i + 1, f }; break; }
  }
  rec(escaped === null,
    'Tab never leaves the dialog, however long it is held down',
    escaped ? `escaped after ${escaped.at} tabs to ${JSON.stringify(escaped.f)}` : '');

  // Shift+Tab backwards must not leak either.
  let escapedBack = null;
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const f = await focused();
    if (!f.inDialog) { escapedBack = { at: i + 1, f }; break; }
  }
  rec(escapedBack === null,
    'and Shift+Tab does not leak backwards past the first control either',
    escapedBack ? `escaped after ${escapedBack.at} back-tabs to ${JSON.stringify(escapedBack.f)}` : '');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const restored = await focused();
  console.log(`   after Escape, focus is on: ${JSON.stringify(restored)}`);
  rec(restored.tag !== 'body' && restored.tag !== 'none',
    'closing with Escape does not dump focus on <body>',
    JSON.stringify(restored));
  rec(restored.text === openerDesc.text && restored.tag === openerDesc.tag,
    'and returns it to the control that opened the dialog',
    `opener ${JSON.stringify(openerDesc)} vs now ${JSON.stringify(restored)}`);
}

// ===========================================================================
// 3. A confirm stacked on a dialog hands focus back to the dialog
// ===========================================================================
console.log('\n===== a nested confirm returns focus to the dialog underneath');
{
  // The REQUIREMENT detail dialog, not the task one.
  //
  // The task flow deliberately closes its dialog before confirming --
  // `handleTaskDelete` runs setIsDetailsDialogOpen(false), with a comment explaining that
  // a confirmation is not a view of a record about to stop existing. Testing the guard
  // there measured intended behaviour and called it a bug. This dialog keeps itself open
  // behind its own AlertDialog, which is the shape dialog.tsx's guard was written for.
  await visit(page, '/requirements', 9000);
  const viewDetails = page.getByRole('button', { name: /^View Details$/ }).first();
  rec(await viewDetails.count() > 0, 'the requirements table offers "View Details"',
    String(await viewDetails.count()));
  if (await viewDetails.count()) await viewDetails.click();
  const opened = await until(async () =>
    (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 20000);
  rec(Boolean(opened), 'the requirement detail dialog opens', '');

  if (opened) {
    // /delete/i, not /^Delete$/: this is an icon button whose accessible name is
    // "Delete this requirement", so an exact match found nothing and the check reported a
    // missing control rather than testing the guard.
    const del = page.locator('[role="dialog"]:visible').getByRole('button', { name: /delete/i }).first();
    if (await del.count()) {
      await del.focus();
      const delDesc = await focused();
      await page.keyboard.press('Enter');

      // Wait for the ALERTDIALOG specifically, and for it to finish opening.
      //
      // Waiting for "some overlay" was already satisfied before Delete was ever pressed --
      // the detail dialog is one — so Escape went out while the confirm was still animating
      // in and had not joined Radix's dismissable-layer stack. Escape was then routed to
      // the layer underneath and closed the dialog, which read as the app losing it.
      const confirmUp = await until(async () => page.evaluate(() => {
        const alert = Array.from(document.querySelectorAll('[role="alertdialog"]'))
          .find((d) => d.getClientRects().length > 0 && d.getAttribute('data-state') === 'open');
        if (!alert) return null;
        return Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
          .filter((d) => d.getClientRects().length > 0).length;
      }), 12000);
      // Let the open transition settle before sending a key at it.
      await page.waitForTimeout(1200);
      console.log(`   visible overlays after pressing Delete: ${confirmUp}`);
      rec(Number(confirmUp) >= 2,
        'a confirmation appears ON TOP of the dialog, which stays up',
        `${confirmUp} visible overlay(s) — 2 is the dialog plus its confirm`);

      // Escape must dismiss only the topmost layer.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1800);
      const stillOpen = await page.evaluate(() => Array.from(
        document.querySelectorAll('[role="dialog"],[role="alertdialog"]'),
      ).filter((d) => d.getClientRects().length > 0).length);
      console.log(`   overlays after Escape: ${stillOpen}`);
      rec(stillOpen >= 1,
        'cancelling the confirm leaves the dialog underneath OPEN',
        `${stillOpen} visible overlay(s) — 0 means the confirm took the dialog with it`);

      const back = await focused();
      console.log(`   focus after cancelling: ${JSON.stringify(back)}`);
      rec(back.inDialog,
        'and focus lands back inside that dialog, not on <body>',
        `${JSON.stringify(back)} (opener was ${JSON.stringify(delDesc)})`);
    } else {
      rec(false, 'the detail dialog offers a Delete control to stack a confirm on', '0 found');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
}

// ===========================================================================
// 4. A focused control looks focused
// ===========================================================================
console.log('\n===== focus is visible');
{
  await visit(page, '/dashboard', 7000);
  // Judged by PIXELS, not by CSS properties.
  //
  // Two earlier versions of this got it wrong in both directions. `el.focus()` does not
  // reliably trigger `:focus-visible`, so scripted focus under-reports. And reading
  // `box-shadow` the instant after a real Tab catches TabsTrigger's `transition-all`
  // part-way through, so the ring reads as transparent and the check accuses a component
  // that has had `focus-visible:ring-2` all along.
  //
  // Comparing the element rendered focused against the same element blurred asks the
  // question a user would. The clip is padded by 6px because an `outline` paints OUTSIDE
  // the border box, and a tight clip would miss it and fail everything that uses one.
  await page.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); });
  const invisible = [];
  const seenKeys = new Set();
  let checked = 0;

  for (let i = 0; i < 45; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return null;
      el.setAttribute('data-focus-probe', '1');
      return {
        key: `${el.tagName}:${String(el.className).slice(0, 44)}:${(el.textContent || '').trim().slice(0, 20)}`,
        label: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`,
      };
    });
    if (!info || seenKeys.has(info.key)) {
      await page.evaluate(() => document.querySelector('[data-focus-probe]')?.removeAttribute('data-focus-probe'));
      continue;
    }
    seenKeys.add(info.key);

    const box = await page.locator('[data-focus-probe]').first().boundingBox();
    if (!box) {
      await page.evaluate(() => document.querySelector('[data-focus-probe]')?.removeAttribute('data-focus-probe'));
      continue;
    }
    const clip = {
      x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6),
      width: box.width + 12, height: box.height + 12,
    };
    const focusedShot = await page.screenshot({ clip });
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(120);
    const restShot = await page.screenshot({ clip });
    checked += 1;
    if (focusedShot.equals(restShot)) invisible.push(info.label);

    await page.evaluate(() => document.querySelector('[data-focus-probe]')?.removeAttribute('data-focus-probe'));
    // Blurring lost the keyboard position; walk back to where this loop was.
    await page.evaluate(() => { document.body.focus(); });
    for (let k = 0; k <= i; k += 1) await page.keyboard.press('Tab');
  }
  const report = { checked, invisible };

  console.log(`   ${report.checked} focusable control(s) checked, ${report.invisible.length} with no visible focus change`);
  for (const i of report.invisible.slice(0, 6)) console.log(`      ${i}`);
  rec(report.checked > 5, 'there were focusable controls to check', String(report.checked));
  rec(report.invisible.length === 0,
    'every focusable control changes appearance when focused',
    report.invisible.slice(0, 5).join(' | '));
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
void parseColor; void contrast;

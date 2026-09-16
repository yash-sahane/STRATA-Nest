// Two detail dialogs hand-rolled their action row, and it showed on a phone.
//
// `DialogFooter` is not just spacing: it is `flex-col-reverse` on mobile, which puts the
// primary action at the TOP of the stack. Both of these used a plain <div> instead --
// `flex-col` in the FR dialog, so Save sat at the BOTTOM there and at the top in every
// other dialog; and `flex gap-4 w-full` with two `w-full` buttons in the task dialog, so
// Edit and Delete each filled half the dialog edge to edge, with Delete -- destructive --
// in the rightmost slot where every other dialog puts its confirm button.
//
// Measured as geometry, not as class names: the question is where the buttons END UP.
// A reference dialog is measured in the same run, so "consistent" means consistent with
// what the app actually does rather than with a value written into this file.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 320)}`); };

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

const browser = await chromium.launch();
const p = await provision('footers');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const cr = await api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'FT-R',
  title: 'Footer requirement', clientName: 'Footer Co', priority: 'HIGH', status: 'DRAFT',
  description: 'Seeded for the footer geometry check.',
});
const fr = await api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, requirementId: cr.j?.id,
  hierarchyId: 'FT-FR', title: 'Footer functional requirement', status: 'DRAFT',
  priority: 'HIGH', complexity: 'MEDIUM', type: 'FUNCTIONAL',
  description: 'Seeded for the footer geometry check.',
});
const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'FT-T',
  title: 'Footer task', status: 'TODO', priority: 'HIGH', assigneeIds: [mgrId],
  description: 'Seeded for the footer geometry check.',
});

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

/**
 * Geometry of the named buttons inside the visible dialog, plus the computed
 * flex-direction of whatever element actually contains them.
 */
const footerGeometry = (names) => page.evaluate((wanted) => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((d) => d.getClientRects().length > 0);
  const dlg = dialogs[dialogs.length - 1];
  if (!dlg) return { error: 'no visible dialog' };

  const found = {};
  for (const name of wanted) {
    const btn = Array.from(dlg.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().toLowerCase() === name.toLowerCase());
    if (!btn) continue;
    const r = btn.getBoundingClientRect();
    found[name] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  // The container that actually lays the buttons out: climb from one button until an
  // ancestor holds more than one of them, or until the dialog.
  const anyName = Object.keys(found)[0];
  let container = null;
  let direction = null;
  if (anyName) {
    const btn = Array.from(dlg.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().toLowerCase() === anyName.toLowerCase());
    let n = btn;
    while (n && n !== dlg) {
      const cs = getComputedStyle(n);
      if (cs.display.includes('flex') && n !== btn) {
        container = n;
        direction = cs.flexDirection;
        // Keep climbing to the outermost flex row/column inside the dialog: the
        // stacking order that matters is the footer's, not an inner group's.
      }
      n = n.parentElement;
    }
  }

  const dlgRect = dlg.getBoundingClientRect();
  return {
    found,
    dialogWidth: dlgRect.width,
    // The FOOTER is the outermost flex container holding the actions.
    footerDirection: direction,
    footerClass: container ? String(container.className).slice(0, 120) : null,
  };
}, names);

// ===========================================================================
// A reference footer: what every other dialog does.
// ===========================================================================
console.log('===== the reference: a dialog that already used DialogFooter');
let reference = null;
{
  await page.setViewportSize(PHONE);
  await visit(page, '/tasks', 9000);
  const newTask = page.getByRole('button', { name: /new task|create task/i }).first();
  if (await newTask.count()) {
    await newTask.click();
    const ready = await until(async () =>
      (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 12000);
    rec(Boolean(ready), 'the create-task dialog opens, to measure the house style against', '');
    reference = await footerGeometry(['Cancel', 'Create Task', 'Create']);
    console.log(`   reference footer direction=${reference.footerDirection}`);
    console.log(`   reference footer class=${reference.footerClass}`);
    rec(reference.footerDirection === 'column-reverse',
      'on a phone the house style stacks the footer column-reverse (primary on top)',
      JSON.stringify({ dir: reference.footerDirection, cls: reference.footerClass }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  } else {
    rec(false, 'a create-task opener was found', 'none matched');
  }
}

// ===========================================================================
// The task details dialog
// ===========================================================================
console.log('\n===== the task details dialog');
{
  // Phone first: is the primary action above the destructive one?
  await page.setViewportSize(PHONE);
  await page.goto(`${BASE}/tasks?taskId=${task.j?.id}`, { waitUntil: 'domcontentloaded' });
  const opened = await until(async () => {
    const n = await page.locator('[role="dialog"]:visible').count();
    return n > 0 ? true : null;
  }, 20000);
  rec(Boolean(opened), 'the task details dialog opens from ?taskId', '');

  if (opened) {
    const phone = await footerGeometry(['Edit', 'Delete']);
    console.log(`   phone: footer direction=${phone.footerDirection}`);
    console.log(`   phone: Edit=${JSON.stringify(phone.found.Edit)} Delete=${JSON.stringify(phone.found.Delete)}`);

    rec(phone.footerDirection === reference?.footerDirection,
      'its footer stacks the same way as the rest of the app on a phone',
      `${phone.footerDirection} vs the reference ${reference?.footerDirection}`);

    if (phone.found.Edit && phone.found.Delete) {
      rec(phone.found.Edit.y < phone.found.Delete.y,
        'and Edit sits ABOVE Delete, so the destructive action is not the first thing under the thumb',
        `Edit y=${phone.found.Edit.y.toFixed(0)} Delete y=${phone.found.Delete.y.toFixed(0)}`);
    } else {
      rec(false, 'both actions were found on the phone layout', JSON.stringify(phone.found));
    }

    // Desktop: content-width buttons, Delete on the left.
    await page.setViewportSize(DESK);
    await page.waitForTimeout(1200);
    const desk = await footerGeometry(['Edit', 'Delete']);
    console.log(`   desktop: dialog=${desk.dialogWidth?.toFixed(0)}px Edit=${JSON.stringify(desk.found.Edit)} Delete=${JSON.stringify(desk.found.Delete)}`);

    if (desk.found.Edit && desk.found.Delete) {
      const halfish = desk.dialogWidth * 0.4;
      rec(desk.found.Edit.w < halfish && desk.found.Delete.w < halfish,
        'on desktop both buttons are content-width, not half the dialog each',
        `Edit ${desk.found.Edit.w.toFixed(0)}px, Delete ${desk.found.Delete.w.toFixed(0)}px, dialog ${desk.dialogWidth.toFixed(0)}px`);
      rec(desk.found.Delete.x < desk.found.Edit.x,
        'and Delete is to the LEFT of Edit, so the destructive action is out of the confirm slot',
        `Delete x=${desk.found.Delete.x.toFixed(0)} Edit x=${desk.found.Edit.x.toFixed(0)}`);
    } else {
      rec(false, 'both actions were found on the desktop layout', JSON.stringify(desk.found));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
}

// ===========================================================================
// The functional-requirement detail dialog
// ===========================================================================
console.log('\n===== the functional requirement detail dialog');
{
  await page.setViewportSize(PHONE);
  await page.goto(`${BASE}/functional-requirements?frId=${fr.j?.id}`, { waitUntil: 'domcontentloaded' });
  const opened = await until(async () => {
    const n = await page.locator('[role="dialog"]:visible').count();
    return n > 0 ? true : null;
  }, 22000);
  rec(Boolean(opened), 'the FR detail dialog opens from ?frId', '');

  if (opened) {
    const phone = await footerGeometry(['Save', 'Delete', 'Clone', 'Close', 'Cancel']);
    console.log(`   phone: footer direction=${phone.footerDirection}`);
    console.log(`   phone: ${JSON.stringify(phone.found)}`);

    rec(phone.footerDirection === reference?.footerDirection,
      'its footer stacks the same way as the rest of the app on a phone',
      `${phone.footerDirection} vs the reference ${reference?.footerDirection}`);

    // The confirm group (Save / Close) must be above the destructive group (Delete).
    const confirmY = phone.found.Save?.y ?? phone.found.Close?.y ?? phone.found.Cancel?.y;
    const deleteY = phone.found.Delete?.y;
    if (confirmY != null && deleteY != null) {
      rec(confirmY < deleteY,
        'and the confirm group sits above Clone/Delete, as it does in every other dialog',
        `confirm y=${confirmY.toFixed(0)} Delete y=${deleteY.toFixed(0)}`);
    } else {
      rec(false, 'the confirm and destructive actions were both found',
        JSON.stringify(phone.found));
    }

    await page.setViewportSize(DESK);
    await page.waitForTimeout(1200);
    const desk = await footerGeometry(['Save', 'Delete', 'Clone', 'Close', 'Cancel']);
    console.log(`   desktop: ${JSON.stringify(desk.found)}`);
    const confirmX = desk.found.Save?.x ?? desk.found.Close?.x ?? desk.found.Cancel?.x;
    if (confirmX != null && desk.found.Delete) {
      rec(desk.found.Delete.x < confirmX,
        'on desktop the split is preserved: destructive left, confirm right',
        `Delete x=${desk.found.Delete.x.toFixed(0)} confirm x=${confirmX.toFixed(0)}`);
    } else {
      rec(false, 'the split could be measured on desktop', JSON.stringify(desk.found));
    }
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

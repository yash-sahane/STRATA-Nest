// Three places the UI held information and withheld it.
//
//  the theme toggle's only name was "Toggle theme" — the icon shows the destination,
//    so a screen-reader user learned neither the current theme nor the next one
//  a task card with >3 labels showed "+2" and no way to learn what those two are
//  a leave reason was line-clamp-2 with no tooltip and no expansion, on the screen
//    where somebody decides whether to approve it
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const p = await provision('hidden');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

// ---- a task with five labels ------------------------------------------------
const LABELS = ['frontend', 'backend', 'urgent', 'regression', 'needs-design'];
const task = await api(mgr, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'HID-1',
  title: 'Task with more labels than fit', status: 'TODO', priority: 'HIGH',
  labels: LABELS, assigneeIds: [devId],
});
rec(task.s === 201, 'a task with five labels exists', `${task.s} ${task.t.slice(0, 200)}`);

// ---- a leave request with a long reason -------------------------------------
const LONG_REASON =
  'I need this time to attend a family wedding in another state, which involves two ' +
  'days of travel either side of the ceremony itself, and I have already arranged ' +
  'cover with the rest of the team for the sprint work that falls in that window.';
const plus = (d) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const leave = await api(dev, 'POST', '/leave_requests', {
  workspaceId: p.ws, type: 'CASUAL', startDate: plus(5), endDate: plus(7), reason: LONG_REASON,
});
rec(leave.s === 201, 'a leave request with a long reason exists', `${leave.s} ${leave.t.slice(0, 200)}`);

// ---- the theme toggle -------------------------------------------------------
console.log('\n===== the theme toggle');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, '/dashboard', 6000);

  const read = () => page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const toggle = buttons.find((b) => /theme/i.test(b.getAttribute('aria-label') ?? '') || /toggle theme/i.test(b.textContent ?? ''));
    return toggle
      ? {
          label: toggle.getAttribute('aria-label'),
          title: toggle.getAttribute('title'),
          root: document.documentElement.className,
        }
      : null;
  });

  const first = await read();
  console.log(`   label=${JSON.stringify(first?.label)} title=${JSON.stringify(first?.title)}`);
  rec(Boolean(first), 'the theme toggle is present', JSON.stringify(first));
  rec(/currently (dark|light)/i.test(first?.label ?? ''),
    'its name says which theme is active', String(first?.label));
  rec(/switch to (dark|light)/i.test(first?.label ?? ''),
    'and which one it would switch to', String(first?.label));

  // Flip it and make sure the name follows, rather than being a fixed string.
  const before = first?.label;
  await page.getByRole('button', { name: /switch to (dark|light) theme/i }).first().click();
  await page.waitForTimeout(2000);
  const second = await read();
  console.log(`   after toggling: ${JSON.stringify(second?.label)}`);
  rec(second?.label !== before, 'and the name changes when the theme does',
    `before ${before}, after ${second?.label}`);
  await ctx.close();
}

// ---- the hidden labels ------------------------------------------------------
console.log('\n===== the "+N" label badge');
{
  const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
  await visit(page, `/tasks?projectId=${p.project}`, 9000);
  const overflow = await page.evaluate(() => {
    const badge = [...document.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && /^\+\d+$/.test((el.textContent ?? '').trim()),
    );
    if (!badge) return null;
    // The badge itself, or the element carrying the title.
    const holder = badge.closest('[title]') ?? badge;
    return {
      text: (badge.textContent ?? '').trim(),
      title: holder.getAttribute('title'),
      label: holder.getAttribute('aria-label'),
    };
  });
  console.log(`   ${JSON.stringify(overflow)}`);
  rec(Boolean(overflow), 'the overflow badge is on screen', JSON.stringify(overflow));
  if (overflow) {
    const hidden = LABELS.slice(3);
    rec(hidden.every((l) => (overflow.title ?? '').includes(l)),
      'it names the labels it is hiding', `title=${overflow.title}`);
    rec(hidden.every((l) => (overflow.label ?? '').includes(l)),
      'and a screen reader is told the same', `aria-label=${overflow.label}`);
  }
  await ctx.close();
}

// ---- the truncated leave reason ---------------------------------------------
console.log('\n===== a truncated leave reason');
{
  const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
  await visit(page, '/leave', 8000);
  const reason = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll('p')].find((n) => (n.textContent ?? '').includes(needle));
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      clamped: cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '',
      title: el.getAttribute('title'),
      focusable: el.tabIndex >= 0,
      fullTextPresent: (el.textContent ?? '').length > 120,
    };
  }, 'family wedding');
  console.log(`   ${JSON.stringify(reason)}`);
  rec(Boolean(reason), 'the reason is rendered', JSON.stringify(reason));
  if (reason) {
    rec(Boolean(reason.title) && reason.title.includes('cover with the rest of the team'),
      'the full reason is available on hover',
      `title=${String(reason.title).slice(0, 120)}`);
    rec(reason.focusable,
      'and reachable from the keyboard, where the clamp lifts',
      `tabIndex focusable=${reason.focusable}`);
    rec(reason.fullTextPresent,
      'the whole text is in the document, not truncated at the source',
      String(reason.fullTextPresent));
  }
  await ctx.close();
}

await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

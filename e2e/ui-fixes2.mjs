// Re-check only the two things that were incomplete: the ?action=create URL
// cleanup, and whether the notifications panel's header buttons are reachable.
import { chromium, signedInPage, visit, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 300)}`); };

const browser = await chromium.launch();
const { ctx, page } = await signedInPage(browser, 'admin@strata.local');

console.log('===== ?action=create opens the dialog and leaves a clean URL');
for (const [route, label] of [['/tasks', 'Task'], ['/projects', 'Project'], ['/sprints', 'Sprint'], ['/epics', 'Epic']]) {
  await visit(page, `${route}?action=create`, 5000);
  const dialogs = await page.locator('[role="dialog"]').count();
  rec(dialogs > 0, `${route} opens the Create ${label} dialog`, `dialogs=${dialogs}`);
  rec(!/action=create/.test(page.url()), `  ...and the consumed parameter is gone`, page.url());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  // Closing must not leave it able to reopen on a re-render.
  const reopened = await page.locator('[role="dialog"]').count();
  rec(reopened === 0, `  ...and it stays closed once dismissed`, String(reopened));
  // A plain visit with no parameter must NOT open anything.
  await visit(page, route, 4000);
  const bare = await page.locator('[role="dialog"]').count();
  rec(bare === 0, `  ...and a plain ${route} opens no dialog`, String(bare));
}

console.log('\n===== every control in the notifications panel is reachable');
{
  await visit(page, '/dashboard', 4000);
  await page.getByRole('button', { name: /notifications/i }).first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  // Walk the whole panel forwards and collect what is reachable.
  const seen = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    seen.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      const label = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 34);
      return `${a.tagName.toLowerCase()}[${a.getAttribute('role') || '-'}]:${label}`;
    }));
  }
  const uniq = [...new Set(seen)];
  console.log('   reachable: ' + JSON.stringify(uniq.slice(0, 8), null, 0));
  // >= 2, not >= 3: how many distinct controls exist depends on how many
  // notifications this account happens to be holding, and with a single
  // notification a row plus its delete button IS the complete set. What this
  // must prove is that focus MOVES through the panel instead of sticking on the
  // container the way the old role="menu" did — the checks below then pin down
  // that it reaches each KIND of control.
  rec(uniq.length >= 2, 'Tab moves through distinct controls rather than sticking', uniq.join(' | '));
  rec(seen.some((s) => /Delete notification/i.test(s)), 'the per-row delete buttons are reachable', uniq.join(' | ').slice(0, 200));
  // Was `/\[button\]/` — it matched role="button" on the row DIV itself, which
  // is the shape that made every row an axe nested-interactive violation (28 of
  // them in one open popover, since the row also contains its delete button). The
  // row's ACTION is what has to be reachable, and it now is: a real <button>
  // named "Open: <title>" or "Mark as read: <title>", a sibling of the delete
  // button rather than its ancestor.
  rec(
    seen.some((s) => /^button\[-\]:(Open|Mark as read):/.test(s)),
    "each row's own action is reachable, without an interactive ancestor",
    uniq.join(' | ').slice(0, 200),
  );

  // Shift+Tab back to the top must reach the header action.
  const back = [];
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(90);
    back.push(await page.evaluate(() => {
      const a = document.activeElement;
      return (a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 34);
    }));
  }
  const header = back.some((b) => /mark all read|clear all/i.test(b));
  rec(header, 'Shift+Tab reaches the header action (Mark all read / Clear all)', back.filter(Boolean).slice(0, 6).join(' | '));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  rec((await page.locator('[data-radix-popper-content-wrapper]').count()) === 0, 'Escape still closes it');
}

await ctx.close();
await browser.close();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

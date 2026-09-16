// A dialog that drew nothing while it loaded, a badge that filled its cell, and half a
// motion scale that was dead code.
//
//  1. client-requirement-detail-dialog returned null whenever it had no data, which
//     conflated "closed" with "open, fetch in flight". Clicking "View Details" opened NO
//     dialog until the response landed, so the click read as ignored; a fetch that FAILED
//     stayed blank forever with nothing to retry.
//
//  2. The working-Saturday W badge is a flex item of a flex-col day cell, so the default
//     align-items:stretch made a two-character label span the whole cell.
//
//  3. globals.css declares four durations and says what each is for. `overlay` and
//     `layout` had consumers; `micro` and `standard` had NONE, while a hard-coded
//     `duration-200` stood in for micro at 15 hover sites. Measured here from the
//     rendered element, because a token is only live if it reaches the DOM.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 320)}`); };

const browser = await chromium.launch();
const p = await provision('motion');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);
void mgrId;

// Two requirements: the slow-load case and the failed-load case need distinct query
// keys, or TanStack Query serves the second from the first one's cache.
const mk = async (title, hier) => {
  const r = await api(mgr, 'POST', '/client_requirements', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: hier,
    title, clientName: 'Motion Co', priority: 'HIGH', status: 'DRAFT',
    description: 'Seeded to exercise the detail dialog loading path.',
  });
  if (r.s !== 201) rec(false, `seeded ${title}`, `${r.s} ${r.t.slice(0, 200)}`);
  return r.j?.id;
};
const slowId = await mk('Slow to load requirement', 'MO-SLOW');
const failId = await mk('Fails to load requirement', 'MO-FAIL');

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

/** getComputedStyle reports `.12s`, not the `120ms` it was authored as. */
const ms = (value) => {
  const v = String(value).trim();
  if (v.endsWith('ms')) return parseFloat(v);
  if (v.endsWith('s')) return parseFloat(v) * 1000;
  return NaN;
};

/** Poll until `fn()` is truthy, up to `ms`. Returns what it saw, or null. */
const until = async (fn, ms = 12000, step = 200) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

// ===========================================================================
// 1. The detail dialog opens AT ONCE and says what it is doing
// ===========================================================================
console.log('===== the requirement detail dialog while it loads');
{
  await visit(page, '/requirements', 8000);

  const rowButton = () => page.getByRole('button', { name: /^View Details$/ });
  const haveRows = await until(async () => (await rowButton().count()) > 0, 15000);
  rec(Boolean(haveRows), 'the requirements table offers "View Details"',
    `buttons=${await rowButton().count()}`);

  if (haveRows) {
    // Hold the single-requirement GET open so the in-flight state is observable at all.
    // Without this the fetch resolves in a few ms and the bug is invisible -- which is
    // exactly why it survived: it only shows on a slow connection.
    let held = 0;
    // A RegExp, not a glob. The request URL is `/api/v1/client_requirements/<id>/` with a
    // trailing slash (lib/api/client.ts), and Playwright's glob `*` does not cross `/`,
    // so the glob form silently matched nothing and the hold never happened.
    const slowUrl = new RegExp(`/api/v1/client_requirements/${slowId}/`);
    await page.route(slowUrl, async (route) => {
      held += 1;
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });

    // Click the row whose title is the slow one.
    const slowRow = page.locator('tr').filter({ hasText: 'Slow to load requirement' }).first();
    rec(await slowRow.count() > 0, 'the slow requirement has a row', String(await slowRow.count()));
    await slowRow.getByRole('button', { name: /^View Details$/ }).click();

    // The whole point: a dialog, visible, well before the response lands.
    const dialog = page.locator('[role="dialog"]:visible').first();
    const openedFast = await until(async () => (await dialog.count()) > 0, 1500, 100);
    rec(Boolean(openedFast),
      'a dialog is on screen within 1.5s of the click, long before the 4s response',
      `dialog count=${await dialog.count()} (this is the regression: it used to stay closed)`);

    if (openedFast) {
      // ONE snapshot. The loading state lives only as long as the held response, so
      // probing it field by field (count, then text, then aria-busy) let it expire
      // mid-assertion and the last read waited on an element that was already gone.
      const snap = await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
          .find((d) => d.offsetParent !== null || d.getClientRects().length > 0);
        const sk = document.querySelector('[data-testid="requirement-detail-loading"]');
        return {
          dialogText: dlg ? (dlg.innerText || '').slice(0, 300) : null,
          skeletonPresent: Boolean(sk),
          ariaBusy: sk ? sk.getAttribute('aria-busy') : null,
          skeletonBars: sk ? sk.querySelectorAll('*').length : 0,
        };
      });
      console.log(`   while loading: skeleton=${snap.skeletonPresent} aria-busy=${snap.ariaBusy} bars=${snap.skeletonBars}`);
      rec(snap.skeletonPresent, 'and it shows a loading placeholder', JSON.stringify(snap));
      rec(/Loading requirement/i.test(snap.dialogText ?? ''),
        'and names what it is loading',
        String(snap.dialogText).slice(0, 200).replace(/\n/g, ' | '));
      rec(snap.ariaBusy === 'true',
        'and marks itself aria-busy so it is announced, not silent',
        String(snap.ariaBusy));
    }

    // Then the real content replaces it.
    //
    // Read the input VALUE, not the dialog's innerText: the title is rendered in an
    // <Input> for editing, and innerText never includes a form control's value, so the
    // text search could not have succeeded however long it waited.
    const loaded = await until(async () => page.evaluate(() => {
      const hit = Array.from(document.querySelectorAll('input, textarea'))
        .map((el) => el.value)
        .find((v) => /Slow to load requirement/.test(v ?? ''));
      return hit ?? null;
    }), 15000);
    rec(Boolean(loaded), 'the real requirement replaces the placeholder once it arrives',
      String(loaded).slice(0, 200).replace(/\n/g, ' | '));
    rec(await page.locator('[data-testid="requirement-detail-loading"]').count() === 0,
      'and the placeholder is gone',
      String(await page.locator('[data-testid="requirement-detail-loading"]').count()));
    rec(held > 0, 'the slow response was actually intercepted (the test tested something)',
      `intercepted ${held}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.unroute(slowUrl);
  }
}

// ---- a fetch that FAILS says so, and offers a retry -------------------------
console.log('\n===== the detail dialog when the fetch fails');
{
  let attempts = 0;
  const failUrl = new RegExp(`/api/v1/client_requirements/${failId}/`);
  await page.route(failUrl, async (route) => {
    attempts += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
  });

  const failRow = page.locator('tr').filter({ hasText: 'Fails to load requirement' }).first();
  if (await failRow.count()) {
    await failRow.getByRole('button', { name: /^View Details$/ }).click();

    const dialog = page.locator('[role="dialog"]:visible').first();
    const text = await until(async () => {
      const t = await dialog.innerText().catch(() => '');
      return /unavailable/i.test(t) ? t : null;
    }, 20000);
    rec(Boolean(text), 'a failed fetch says the requirement is unavailable rather than staying blank',
      String(await dialog.innerText().catch(() => '')).slice(0, 250).replace(/\n/g, ' | '));

    const retry = dialog.getByRole('button', { name: /try again/i });
    rec(await retry.count() > 0, 'and offers a retry', `retry count=${await retry.count()}`);
    const close = dialog.getByRole('button', { name: /^Close$/ });
    rec(await close.count() > 0, 'and a way out', `close count=${await close.count()}`);

    if (await retry.count()) {
      const before = attempts;
      await retry.click();
      const retried = await until(async () => attempts > before, 10000);
      rec(Boolean(retried), 'the retry actually re-requests', `attempts ${before} -> ${attempts}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } else {
    rec(false, 'the failing requirement has a row', '0 rows matched');
  }
  await page.unroute(failUrl);
}

// ===========================================================================
// 2. The working-Saturday badge is content-width, not cell-width
// ===========================================================================
console.log('\n===== the working-Saturday badge');
{
  // The calendar is the `calendar` tab and the page opens on `today`, so plain
  // /attendance never renders the badge. The page carries tab state in the URL.
  await visit(page, '/attendance?tab=calendar', 9000);

  const badge = page.locator('div').filter({ hasText: /^W[1-5]$/ }).first();
  // The badge renders as a Badge (a div/span) whose whole text is W<n>.
  const found = await until(async () => {
    const n = await page.getByText(/^W[1-5]$/).count();
    return n > 0 ? n : null;
  }, 12000);
  rec(Boolean(found), 'a working-Saturday W badge is on the calendar',
    `matches=${await page.getByText(/^W[1-5]$/).count()}`);

  if (found) {
    const el = page.getByText(/^W[1-5]$/).first();

    // The DAY CELL is the badge's grandparent: badge -> flex-col wrapper -> cell.
    // An earlier version climbed four parents and measured the whole 1118px calendar
    // grid, against which the assertion could not fail -- a stretched badge is one
    // column wide and still well under 75% of the grid.
    const measured = await el.evaluate((node) => {
      const wrapper = node.parentElement;
      const cell = wrapper?.parentElement;
      const before = node.getBoundingClientRect().width;
      const cellWidth = cell ? cell.getBoundingClientRect().width : NaN;

      // Falsify the check: take the fix away and the badge must stretch. If it does
      // not, this measurement is not measuring the fix.
      node.classList.remove('w-fit');
      const withoutFix = node.getBoundingClientRect().width;
      node.classList.add('w-fit');

      return {
        badge: before,
        cell: cellWidth,
        withoutFix,
        cellTag: cell ? `${cell.tagName}.${(cell.className || '').slice(0, 40)}` : null,
      };
    });

    console.log(`   day cell ${measured.cell.toFixed(1)}px  badge ${measured.badge.toFixed(1)}px  (without w-fit: ${measured.withoutFix.toFixed(1)}px)`);
    console.log(`   cell is ${measured.cellTag}`);

    rec(measured.cell > 20 && measured.cell < 400,
      'the element measured as the day cell is plausibly one day cell, not the whole grid',
      `${measured.cell.toFixed(1)}px (${measured.cellTag})`);

    rec(measured.badge < measured.cell * 0.6,
      'the W badge is content-width, not stretched across the whole day cell',
      `badge ${measured.badge.toFixed(1)}px vs cell ${measured.cell.toFixed(1)}px`);

    rec(measured.withoutFix > measured.badge * 1.5,
      'and removing w-fit DOES stretch it, so this check can actually fail',
      `${measured.badge.toFixed(1)}px with w-fit vs ${measured.withoutFix.toFixed(1)}px without`);
    void badge;
  }
}

// ===========================================================================
// 3. Every entry in the motion scale reaches the DOM
// ===========================================================================
console.log('\n===== the motion scale is live, not declared-and-ignored');
{
  await visit(page, '/dashboard', 8000);

  const scale = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      micro: cs.getPropertyValue('--duration-micro').trim(),
      standard: cs.getPropertyValue('--duration-standard').trim(),
      overlay: cs.getPropertyValue('--duration-overlay').trim(),
      layout: cs.getPropertyValue('--duration-layout').trim(),
    };
  });
  console.log(`   declared: ${JSON.stringify(scale)}`);
  rec(ms(scale.micro) === 120 && ms(scale.standard) === 180
      && ms(scale.overlay) === 240 && ms(scale.layout) === 320,
    'the four durations are declared as documented',
    JSON.stringify(scale) + ' -> ' + JSON.stringify({
      micro: ms(scale.micro), standard: ms(scale.standard),
      overlay: ms(scale.overlay), layout: ms(scale.layout),
    }));

  // micro, via the hover-lift utility that replaced 15 copies of `duration-200`.
  const lift = page.locator('.hover-lift').first();
  const haveLift = await until(async () => (await lift.count()) > 0, 12000);
  rec(Boolean(haveLift), 'the hover-lift utility is in use on the dashboard',
    `count=${await page.locator('.hover-lift').count()}`);

  if (haveLift) {
    const style = await lift.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        duration: cs.transitionDuration,
        property: cs.transitionProperty,
        shadow: cs.boxShadow,
      };
    });
    console.log(`   hover-lift transition: ${style.duration} on ${style.property.slice(0, 40)}`);
    rec(ms(style.duration) === 120,
      'a hover-lift card transitions at --duration-micro (120ms), not the old hard-coded 200ms',
      JSON.stringify(style));

    // And the lift itself still happens — tokenizing the duration must not have cost
    // the behaviour the class exists for.
    const before = await lift.boundingBox();
    await lift.hover();
    await page.waitForTimeout(400);
    const after = await lift.evaluate((el) => ({
      transform: getComputedStyle(el).transform,
      translate: getComputedStyle(el).translate,
      shadow: getComputedStyle(el).boxShadow,
    }));
    const moved = after.transform !== 'none' || (after.translate && after.translate !== 'none');
    console.log(`   on hover: translate=${after.translate} transform=${after.transform.slice(0, 40)}`);
    rec(moved, 'and hovering still lifts the card', JSON.stringify(after).slice(0, 250));
    rec(after.shadow && after.shadow !== 'none', 'and still raises its shadow',
      String(after.shadow).slice(0, 120));
    void before;
  }

  // standard, on a menu surface the user opens.
  const trigger = page.locator('[aria-haspopup="menu"]').first();
  if (await trigger.count()) {
    await trigger.click();
    const content = page.locator('[data-radix-popper-content-wrapper] [role="menu"]').first();
    const shown = await until(async () => (await content.count()) > 0, 6000);
    if (shown) {
      const dur = await content.evaluate((el) => getComputedStyle(el).animationDuration);
      console.log(`   dropdown animation-duration: ${dur}`);
      rec(ms(dur) === 180,
        'an open dropdown animates at --duration-standard (180ms), not the 150ms default',
        String(dur));
    } else {
      rec(false, 'a dropdown menu opened to measure', 'no [role=menu] appeared');
    }
    await page.keyboard.press('Escape');
  } else {
    rec(false, 'a menu trigger was found on the dashboard', 'no [aria-haspopup=menu]');
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

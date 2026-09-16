// Every coloured toast type, measured as RENDERED, in both themes.
//
// sonner ships its own palette for success/info/warning/error, and in light theme all
// four put their text under the 4.5:1 AA floor on their own tinted background — warning
// worst at 3.08:1. The whole-app sweep caught only `info`, because an inbound realtime
// notification happened to be the one toast on screen; the rest came from reading
// sonner's stylesheet.
//
// Why the first override did nothing: sonner does not ship its CSS as a file the bundler
// can order, it injects a <style> element at runtime. That lands AFTER the app's
// stylesheet, and its rule is the same selector at the same specificity (0,2,0), so on
// order alone sonner wins. The override therefore carries `:root` plus the toaster, theme
// and type attributes, reaching (0,6,0), and sets `color` under private `--toast-aa-*`
// names rather than redefining sonner's -- which would shadow app tokens of the same name.
//
// Measured from the live DOM rather than from either stylesheet, so the override is
// proven to actually apply. Two passes, because each covers the other's blind spot:
//
//   1. a REAL toast, raised by a real user action, for the type that action produces.
//      Proves the cascade applies to what sonner actually renders.
//   2. a CONSTRUCTED node carrying sonner's own attributes inside a real toaster, for
//      all four types in both themes. Reaches the combinations no single action can.
//
// Pass 1 is the check on pass 2: if the two disagree for the type they share, the
// construction is not reproducing a real toast and nothing it reports can be trusted.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';
import { parseColor, contrast } from './color-utils.mjs';

const AA = 4.5;
const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };

const TYPES = ['success', 'info', 'warning', 'error'];

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('toastaa');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

/** Read the rendered colours of one live toast element. */
const readToast = (locatorHandle) => locatorHandle.evaluate((el) => {
  const title = el.querySelector('[data-title]') ?? el;
  return {
    type: el.getAttribute('data-type'),
    bg: getComputedStyle(el).backgroundColor,
    fg: getComputedStyle(title).color,
    text: (title.textContent ?? '').slice(0, 60),
    richColors: el.getAttribute('data-rich-colors'),
  };
});

const ratio = (fg, bg) => {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b || b.alpha === 0) return null;
  return contrast(f.rgb, b.rgb);
};

// ===========================================================================
// 1. A REAL toast, from a real action.
//
// The toast shim maps "no variant" onto sonner's SUCCESS toast, and ~35 mutation
// confirmations omit the variant — so any successful mutation raises a real success
// toast. "Mark all read" in the notification panel is the cheapest of them: seed unread
// notifications, open the bell, click it once.
// ===========================================================================
console.log('===== a real success toast, raised by a real action (light theme)');
let realSuccess = null;
{
  for (let i = 0; i < 3; i += 1) {
    const r = await api(admin, 'POST', '/notifications', {
      workspaceId: p.ws,
      userId: mgrId,
      type: 'task_assigned',
      title: `Contrast probe ${i}`,
      message: 'seeded so that "Mark all read" has something to do',
      relatedEntityType: 'task',
      relatedEntityId: `probe-${i}`,
    });
    if (r.s !== 201) rec(false, `seeded notification ${i}`, `${r.s} ${r.t.slice(0, 160)}`);
  }

  // Light theme, because that is the half that fails.
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light');
  });
  await visit(page, '/dashboard', 6000);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.classList.remove('dark');
  });

  const bell = page.getByRole('button', { name: /notification/i }).first();
  rec(await bell.count() > 0, 'the notification bell is reachable', String(await bell.count()));
  await bell.click();
  await page.waitForTimeout(3000);

  const markAll = page.getByRole('button', { name: /mark all read/i }).first();
  if (await markAll.count()) {
    await markAll.click();

    // Poll for the toast rather than sleeping: under suite load a fixed wait is
    // either a false failure or dead time.
    const toast = page.locator('[data-sonner-toast]').first();
    let appeared = false;
    for (let i = 0; i < 40; i += 1) {
      if (await toast.count()) { appeared = true; break; }
      await page.waitForTimeout(250);
    }
    rec(appeared, 'clicking "Mark all read" raises a real toast', 'no [data-sonner-toast] appeared');

    if (appeared) {
      const handle = await toast.elementHandle();
      realSuccess = await readToast(handle);
      const r = ratio(realSuccess.fg, realSuccess.bg);
      console.log(`   real toast  type=${realSuccess.type} rich-colors=${realSuccess.richColors}`);
      console.log(`   ${realSuccess.fg} on ${realSuccess.bg}  ${r === null ? 'unreadable' : r.toFixed(2) + ':1'}  ${JSON.stringify(realSuccess.text)}`);
      rec(realSuccess.richColors === 'true',
        'the real toaster has richColors on, so the coloured palette is the one in use',
        String(realSuccess.richColors));
      rec(r !== null && r >= AA,
        `a REAL ${realSuccess.type} toast clears the AA floor`,
        `${r === null ? 'unreadable' : r.toFixed(2) + ':1'} (${realSuccess.fg} on ${realSuccess.bg})`);
    }
  } else {
    rec(false, 'the notification panel offers "Mark all read"', 'button not found');
  }
}

// ===========================================================================
// 2. All four types, both themes, from a constructed node.
// ===========================================================================
const measure = async (theme) => {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  await page.waitForTimeout(600);

  return page.evaluate(({ types, theme: th }) => {
    let toaster = document.querySelector('[data-sonner-toaster]');
    let synthetic = false;
    if (!toaster) {
      // sonner mounts its container only once a toast exists. Reproduce the container
      // with sonner's own attributes instead: its stylesheet and the app's override are
      // both loaded in this document, so the cascade here is the real one.
      toaster = document.createElement('section');
      toaster.setAttribute('data-sonner-toaster', '');
      toaster.setAttribute('data-sonner-theme', th);
      document.body.appendChild(toaster);
      synthetic = true;
    } else {
      toaster.setAttribute('data-sonner-theme', th);
    }
    const themeAttr = toaster.getAttribute('data-sonner-theme');

    const results = {};
    for (const type of types) {
      const el = document.createElement('li');
      el.setAttribute('data-sonner-toast', '');
      el.setAttribute('data-type', type);
      el.setAttribute('data-styled', 'true');
      el.setAttribute('data-rich-colors', 'true');
      const title = document.createElement('div');
      title.setAttribute('data-title', '');
      title.textContent = 'Contrast probe';
      el.appendChild(title);
      toaster.appendChild(el);
      results[type] = {
        bg: getComputedStyle(el).backgroundColor,
        fg: getComputedStyle(title).color,
      };
      el.remove();
    }
    if (synthetic) toaster.remove();
    return { themeAttr, results, synthetic };
  }, { types: TYPES, theme });
};

const measured = {};
for (const theme of ['light', 'dark']) {
  console.log(`\n===== ${theme}, all four types`);
  const { themeAttr, results, synthetic } = await measure(theme);
  console.log(`   toaster data-sonner-theme=${JSON.stringify(themeAttr)}${synthetic ? ' (container built for the measurement)' : ''}`);
  rec(themeAttr === theme, `${theme}: the toaster is in the theme under test`, String(themeAttr));
  measured[theme] = results;
  for (const type of TYPES) {
    const { bg, fg } = results[type];
    const r = ratio(fg, bg);
    if (r === null) {
      rec(false, `${theme} ${type}: colours are readable from the DOM`, `fg=${fg} bg=${bg}`);
      continue;
    }
    console.log(`   ${type.padEnd(8)} ${fg.padEnd(22)} on ${bg.padEnd(22)} ${r.toFixed(2)}:1`);
    rec(r >= AA, `${theme}: a ${type} toast clears the AA floor`,
      `${r.toFixed(2)}:1 (${fg} on ${bg})`);
  }
}

// ===========================================================================
// An app utility rendered INSIDE a coloured toast keeps its own colour.
//
// sonner declares `--success-text` / `--info-text` / `--warning-text` on its own toaster,
// in both themes, as full hsl() colours. The app used to own those same three names as
// channel triples consumed via `hsl(var(...))`, so inside any toast sonner's value shadowed
// the app's and `text-success-text` computed `hsl(hsl(...))` -- invalid, discarded, and the
// text inherited the toast's colour. That is why the app's tokens are now `--app-*`.
//
// Contrast alone cannot catch this: both spellings measure the same ratio. So the mechanism
// is asserted directly, and the sharp half is the second check -- an app utility in a toast
// must paint a colour of its own, not the toast's.
// ===========================================================================
console.log('\n===== the override does not shadow the app tokens');
{
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.classList.remove('dark');
  });
  await page.waitForTimeout(400);

  const probe = await page.evaluate(() => {
    let toaster = document.querySelector('[data-sonner-toaster]');
    let synthetic = false;
    if (!toaster) {
      toaster = document.createElement('section');
      toaster.setAttribute('data-sonner-toaster', '');
      document.body.appendChild(toaster);
      synthetic = true;
    }
    // Put the toaster back into light theme explicitly. The all-types loop above mutates
    // this attribute and leaves it on 'dark', so without this the guard measured sonner's
    // dark palette while believing it was measuring light.
    toaster.setAttribute('data-sonner-theme', 'light');

    // A real app component's markup, inside a real coloured toast.
    const toast = document.createElement('li');
    toast.setAttribute('data-sonner-toast', '');
    toast.setAttribute('data-type', 'success');
    toast.setAttribute('data-styled', 'true');
    toast.setAttribute('data-rich-colors', 'true');
    const appText = document.createElement('span');
    appText.className = 'text-success-text';
    appText.textContent = 'app token inside a toast';
    toast.appendChild(appText);
    toaster.appendChild(toast);

    const inside = getComputedStyle(toaster);
    const result = {
      // The APP's tokens, as they resolve INSIDE the toaster. These must survive; the
      // bare names next to them are sonner's and are expected to be sonner's colours.
      successToken: inside.getPropertyValue('--app-success-text').trim(),
      infoToken: inside.getPropertyValue('--app-info-text').trim(),
      warningToken: inside.getPropertyValue('--app-warning-text').trim(),
      // What sonner puts on its own names in there, recorded to show the collision that
      // the rename sidesteps rather than merely asserting it is gone.
      sonnerSuccess: inside.getPropertyValue('--success-text').trim(),
      // And what an app utility actually paints in there.
      appTextColor: getComputedStyle(appText).color,
      toastColor: getComputedStyle(toast).color,
    };

    toast.remove();
    if (synthetic) toaster.remove();
    return result;
  });

  console.log(`   inside the toaster: --app-success-text=${JSON.stringify(probe.successToken)}`);
  console.log(`   sonner's own --success-text in there: ${JSON.stringify(probe.sonnerSuccess)}`);
  console.log(`   text-success-text paints ${probe.appTextColor}; the toast itself ${probe.toastColor}`);

  const channelSyntax = /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/;
  rec(channelSyntax.test(probe.successToken)
      && channelSyntax.test(probe.infoToken)
      && channelSyntax.test(probe.warningToken),
    "the app's own colour tokens survive, in channel syntax, inside the toaster",
    JSON.stringify({
      success: probe.successToken, info: probe.infoToken, warning: probe.warningToken,
    }));

  // The collision is real and still there on sonner's names -- which is the point of
  // keeping the app's tokens out of them. Asserted so the rename's reason stays visible.
  rec(/^hsl\(/.test(probe.sonnerSuccess),
    "and sonner still owns the bare --success-text in there, which is why the app's moved",
    JSON.stringify(probe.sonnerSuccess));

  // The sharp one. If the app's token were shadowed, `hsl(hsl(...))` is invalid, the
  // declaration is discarded, and the text inherits -- which here is the toast's own
  // colour. Two different colours prove the utility resolved on its own.
  const appC = parseColor(probe.appTextColor);
  rec(Boolean(appC) && appC.alpha !== 0 && probe.appTextColor !== probe.toastColor,
    'and `text-success-text` inside a coloured toast paints its own colour, not the toast\'s',
    `${probe.appTextColor} vs the toast's ${probe.toastColor}`);
}

// ---- the two methods must agree where they overlap --------------------------
// Without this the constructed measurement is unfalsifiable: it would report whatever
// the construction happens to produce, real toast or not.
console.log('\n===== the real toast and the constructed one agree');
if (realSuccess && realSuccess.type && measured.light[realSuccess.type]) {
  const built = measured.light[realSuccess.type];
  console.log(`   real      ${realSuccess.fg} on ${realSuccess.bg}`);
  console.log(`   construct ${built.fg} on ${built.bg}`);
  rec(built.fg === realSuccess.fg && built.bg === realSuccess.bg,
    `the constructed ${realSuccess.type} toast renders the same colours as the real one`,
    `real ${realSuccess.fg}/${realSuccess.bg} vs built ${built.fg}/${built.bg}`);
} else {
  rec(false, 'a real toast was captured to cross-check the construction against',
    realSuccess ? `type=${realSuccess.type}` : 'no real toast captured');
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

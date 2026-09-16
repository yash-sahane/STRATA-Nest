// Does the priority picker agree with the priority it produces?
//
// lib/semantic/priority.ts exists because six inline priority->colour maps disagreed. Its
// docstring names the symptom: "LOW was gray on the task board but green everywhere else;
// MEDIUM was blue in notifications but yellow elsewhere". The create and edit task dialogs
// were surviving instances of exactly that, with hand-written glyph dots saying
//
//     LOW green, MEDIUM yellow, HIGH orange, CRITICAL red
//
// against the canonical LOW neutral, MEDIUM info, HIGH warning, CRITICAL destructive. So
// picking "Medium" showed a yellow dot and the task then wore a blue Medium badge.
//
// Three of the four glyphs also measured under 3:1 on a light card (yellow 1.91:1) -- the
// one graphic the control exists to show.
//
// This checks the thing that actually matters: the dot in the PICKER and the dot the app
// paints for the SAME priority elsewhere are the same colour. Comparing the picker against
// a constant written into this file would only prove the picker matches this file.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';
import { parseColor } from './color-utils.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 320)}`); };

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Radix ids contain characters a CSS id selector cannot take raw (e.g. `:`). */
const CSS_escape = (id) => id.replace(/([^a-zA-Z0-9_-])/g, '\\$1');

const browser = await chromium.launch();
const p = await provision('privocab');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

// One task per priority, so the app has to paint all four somewhere real.
for (const priority of PRIORITIES) {
  const r = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `PV-${priority.slice(0, 3)}`,
    title: `Priority ${priority} task`, status: 'TODO', priority, assigneeIds: [mgrId],
  });
  if (r.s !== 201) rec(false, `seeded a ${priority} task`, `${r.s} ${r.t.slice(0, 160)}`);
}

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

/** Open a Select by its trigger text and read every option's label + dot colour. */
const readPriorityOptions = async (label) => {
  // Scoped to the OPEN dialog. An unscoped lookup found "Select a project" behind the
  // overlay and then retried the click for 30s while the overlay swallowed it.
  const dialog = page.locator('[role="dialog"]:visible').last();

  // By accessible name first: shadcn's FormLabel labels the trigger via the control id, so
  // the accessible name is "Priority *" even though the trigger's TEXT is the selected
  // value ("Medium") -- which is why matching on text found nothing.
  let target = dialog.getByRole('combobox', { name: /priority/i }).first();

  if (!(await target.count())) {
    // Fall back to the label's htmlFor, resolved in-page.
    const id = await page.evaluate(() => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((d) => d.getClientRects().length > 0)
        .pop();
      if (!dlg) return null;
      const lbl = Array.from(dlg.querySelectorAll('label'))
        .find((l) => /^priority/i.test((l.textContent || '').trim()));
      return lbl ? lbl.getAttribute('for') : null;
    });
    if (!id) return { error: 'no priority control could be located in the dialog' };
    target = page.locator(`#${CSS_escape(id)}`);
  }

  if (!(await target.count())) return { error: 'no priority combobox found' };
  await target.click({ timeout: 10000 });

  const ready = await until(async () =>
    (await page.locator('[role="option"]').count()) >= 4 ? true : null, 8000);
  if (!ready) return { error: 'the option list did not render' };

  const options = await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]'))
    .map((opt) => {
      // The dot is the zero-text span carrying a rounded-full background.
      const dot = Array.from(opt.querySelectorAll('span'))
        .find((sp) => (sp.textContent || '').trim() === ''
          && /rounded-full/.test(String(sp.className)));
      return {
        label: (opt.textContent || '').trim(),
        value: opt.getAttribute('data-value') ?? null,
        dotClass: dot ? String(dot.className) : null,
        dotColor: dot ? getComputedStyle(dot).backgroundColor : null,
        // A text glyph dot -- what this used to be -- shows up as a coloured bullet.
        glyph: Array.from(opt.querySelectorAll('span'))
          .some((sp) => (sp.textContent || '').trim() === '●'),
      };
    }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log(`   ${label}: ${options.map((o) => `${o.label}=${o.dotColor}`).join('  ')}`);
  return { options };
};

// ---- the picker in both dialogs ---------------------------------------------
const pickers = {};
for (const [route, opener, name] of [
  ['/tasks', /new task|create task/i, 'create dialog'],
]) {
  console.log(`\n===== the priority picker in the ${name}`);
  await visit(page, route, 9000);
  const btn = page.getByRole('button', { name: opener }).first();
  rec(await btn.count() > 0, `the ${name} has an opener`, String(await btn.count()));
  if (!(await btn.count())) continue;
  await btn.click();
  await until(async () => (await page.locator('[role="dialog"]:visible').count()) > 0 ? true : null, 10000);

  const read = await readPriorityOptions(name);
  if (read.error) { rec(false, `the ${name} priority options could be read`, read.error); continue; }
  pickers[name] = read.options;

  rec(read.options.length === 4, `the ${name} offers four priorities`,
    `${read.options.length}: ${read.options.map((o) => o.label).join(', ')}`);
  rec(read.options.every((o) => !o.glyph),
    'and none of them is a coloured text bullet any more',
    JSON.stringify(read.options.map((o) => ({ l: o.label, glyph: o.glyph }))));
  rec(read.options.every((o) => o.dotClass && /rounded-full/.test(o.dotClass)),
    'each option carries a solid round dot',
    JSON.stringify(read.options.map((o) => o.dotClass)));

  for (const o of read.options) {
    const c = parseColor(o.dotColor);
    rec(Boolean(c) && c.alpha !== 0,
      `the ${o.label} dot has a real fill`, `${o.label} -> ${o.dotColor}`);
  }

  // The labels must be the resolver's, not hand-written.
  const labels = read.options.map((o) => o.label);
  rec(JSON.stringify(labels) === JSON.stringify(['Low', 'Medium', 'High', 'Critical']),
    'and the labels are the canonical ones, in the canonical order',
    JSON.stringify(labels));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

// ---- and the dot the app paints for the same priority elsewhere --------------
console.log('\n===== the same priority, painted on the board');
{
  await visit(page, '/tasks', 10000);

  // Task rows/cards carry a priority dot from the same resolver.
  const boardDots = await page.evaluate((priorities) => {
    const result = {};
    for (const pr of priorities) {
      // The MOST SPECIFIC element holding both the title and a dot -- not the first in
      // document order, which is outermost-first and matched a page-level wrapper whose
      // unrelated rounded span measured rgba(0,0,0,0).
      const candidates = Array.from(document.querySelectorAll('*')).filter((el) =>
        (el.textContent || '').includes(`Priority ${pr} task`)
        && el.querySelector('span[class*="rounded-full"]'));
      if (!candidates.length) continue;
      const host = candidates.reduce((best, el) =>
        el.querySelectorAll('*').length < best.querySelectorAll('*').length ? el : best);

      // Among its dots, the one that actually has a fill; a card can carry more than one
      // rounded span (avatars, borders) and only some are painted.
      const dots = Array.from(host.querySelectorAll('span[class*="rounded-full"]'));
      const painted = dots
        .map((d) => getComputedStyle(d).backgroundColor)
        .find((c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
      if (painted) result[pr] = painted;
    }
    return result;
  }, PRIORITIES);

  console.log(`   board dots: ${JSON.stringify(boardDots)}`);
  const picker = pickers['create dialog'];
  if (!picker) {
    rec(false, 'the picker colours were captured to compare against', 'no picker read');
  } else {
    const byLabel = Object.fromEntries(picker.map((o) => [o.label.toLowerCase(), o.dotColor]));
    let compared = 0;
    for (const pr of PRIORITIES) {
      const boardColor = boardDots[pr];
      const pickerColor = byLabel[pr.toLowerCase()];
      if (!boardColor || !pickerColor) {
        rec(false, `${pr}: a painted dot was found on the task to compare against`,
          `painted=${boardColor ?? 'none'} picker=${pickerColor ?? 'none'}`);
        continue;
      }
      // A transparent fill means the wrong element was located, not that the colours
      // differ. Say which, rather than reporting a colour mismatch against nothing.
      if (boardColor === 'rgba(0, 0, 0, 0)' || boardColor === 'transparent') {
        rec(false, `${pr}: the located dot has a real fill (else the wrong node was found)`,
          `painted=${boardColor}`);
        continue;
      }
      compared += 1;
      rec(boardColor === pickerColor,
        `${pr}: the picker dot and the dot painted on the task are the same colour`,
        `picker ${pickerColor} vs painted ${boardColor}`);
    }
    rec(compared > 0,
      'at least one priority could be compared end to end (picker vs painted)',
      `compared ${compared} of ${PRIORITIES.length}`);
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

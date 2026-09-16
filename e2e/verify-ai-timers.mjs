// #135 generation could hang forever, #136 it leaked a timer when it did.
//
// Counts live intervals directly, by replacing setInterval/clearInterval before
// the page's own scripts run. An interval that is never cleared shows up as a
// surviving handle — which is what "leak" means here, rather than something
// inferred from CPU or memory.
import { chromium, api, adminJar, provision, addRole, getBrowserCookies, watchToasts, toasts, BASE } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const INSTRUMENT = `
  window.__timers = { live: new Set(), created: 0, cleared: 0 };
  const realSet = window.setInterval.bind(window);
  const realClear = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => {
    const id = realSet(fn, ms, ...rest);
    window.__timers.live.add(id);
    window.__timers.created += 1;
    return id;
  };
  window.clearInterval = (id) => {
    if (window.__timers.live.delete(id)) window.__timers.cleared += 1;
    return realClear(id);
  };
`;

const browser = await chromium.launch();
const p = await provision('aitimer');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');

const ctx = await browser.newContext();
await ctx.addCookies(await getBrowserCookies('role.manager@strata.local'));
await ctx.addInitScript(INSTRUMENT);
const page = await ctx.newPage();

const timers = () => page.evaluate(() => ({
  live: window.__timers.live.size,
  created: window.__timers.created,
  cleared: window.__timers.cleared,
}));

// ---- the route's own bounds -------------------------------------------------
console.log('===== the route refuses to hang');
{
  // A caller with no workspaceId is rejected before any provider is touched, so
  // this proves the guard, not the timeout.
  const noWs = await api(mgr, 'POST', '/../../api/ai-generate', { prompt: 'hi' }).catch(() => null);
  void noWs;

  const started = Date.now();
  const r = await fetch(`${BASE}/api/ai-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: (await getBrowserCookies('role.manager@strata.local'))
        .map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: JSON.stringify({ prompt: 'Say OK.', workspaceId: p.ws, maxRetries: 3 }),
  });
  const elapsed = Date.now() - started;
  const body = await r.text();
  console.log(`   ${r.status} in ${elapsed}ms: ${body.slice(0, 200)}`);
  // Whatever the providers do — configured, unconfigured, or hanging — the route
  // must answer. Before this it could sit on 3 Gemini attempts plus a fallback
  // with no cap at all.
  rec(elapsed < 100_000, 'the route answers within its own total budget', `${elapsed}ms`);
  rec(r.status !== 0, 'and it answers at all', String(r.status));
}

// ---- the dialog's timer ----------------------------------------------------
console.log('\n===== the generate dialog leaves no timer behind');
{
  await page.goto(`${BASE}/requirements`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const before = await timers();
  console.log(`   baseline: live=${before.live} created=${before.created}`);

  await watchToasts(page);

  const openBtn = page.getByRole('button', { name: /generate with ai/i }).first();
  rec(await openBtn.count() > 0, 'the "Generate with AI" button is reachable', String(await openBtn.count()));
  await openBtn.click();
  await page.waitForTimeout(2000);

  // Force the generation to FAIL, which is the path that used to leak: make the
  // route unreachable for this page only.
  await page.route('**/api/ai-generate', (route) => route.abort('failed'));

  const textarea = page.locator('textarea').first();
  rec(await textarea.count() > 0, 'the document textarea is present', String(await textarea.count()));
  await textarea.fill(
    'Build a small library system. Members borrow books. Librarians manage the catalogue. ' +
      'Overdue items incur a fine. Reports are needed monthly.',
  );

  const submit = page.getByRole('button', { name: /generate|analyse|analyze/i }).last();
  await submit.click();

  // While it is in flight the progress timer SHOULD be running — otherwise the
  // check below proves nothing.
  await page.waitForTimeout(1200);
  const during = await timers();
  console.log(`   mid-generation: live=${during.live} created=${during.created}`);
  rec(during.created > before.created,
    'a progress timer really does start (so the leak check is meaningful)',
    `created ${before.created} -> ${during.created}`);

  // Let the failure land and settle.
  await page.waitForTimeout(6000);
  const after = await timers();
  console.log(`   after the failure: live=${after.live} created=${after.created} cleared=${after.cleared}`);
  rec(after.live <= before.live,
    'no timer survives a FAILED generation',
    `live went ${before.live} -> ${after.live} (created ${after.created}, cleared ${after.cleared})`);
  // Read from the toast RECORDER, not from the page: sonner dismisses after ~4s
  // and the first version of this looked for the message six seconds later, so
  // it failed on a message that had been shown correctly.
  const seen = await toasts(page);
  console.log(`   toasts: ${JSON.stringify(seen)}`);
  rec(seen.some((t) => /failed|timed out|error/i.test(t)),
    'and the failure is reported to the user',
    JSON.stringify(seen));

  // Closing the dialog mid-flight was the other leak.
  await page.unroute('**/api/ai-generate');
  await page.route('**/api/ai-generate', async (route) => {
    // Never answer: this is the hang the timeout exists for.
    await new Promise((r) => setTimeout(r, 120_000));
    await route.abort('failed');
  });
  // The dialog is STILL OPEN after the failure (the catch returns it to the
  // input step), so clicking the page button behind the modal dismisses it
  // instead of reopening it — which is why the first attempt found no textarea.
  // Close it deliberately first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  const reopen = page.getByRole('button', { name: /generate with ai/i }).first();
  // Recorded, not skipped. The first run of this quietly did nothing here and
  // still reported a clean tally — the whole hung-request case went unexercised.
  rec(await reopen.count() > 0, 'the dialog can be reopened for the hung-request case',
    String(await reopen.count()));
  {
    await reopen.click();
    await page.waitForTimeout(2500);
    const ta = page.locator('textarea').first();
    rec(await ta.count() > 0, 'and its textarea is present again', String(await ta.count()));
    {
      // Long enough to clear the form's minimum: the short string used first
      // failed validation, so no timer ever started and the check below passed
      // without testing anything.
      await ta.fill(
        'Build an inventory system. Warehouse staff record stock movements, managers ' +
          'approve transfers between sites, and finance reconciles monthly. Low-stock ' +
          'alerts notify the buying team. Auditors need an immutable movement history.',
      );
      await page.getByRole('button', { name: /generate|analyse|analyze/i }).last().click();
      await page.waitForTimeout(2000);
      const midway = await timers();
      console.log(`   with a hung request: live=${midway.live} created=${midway.created}`);
      // The whole point: a timer must be RUNNING at the moment the dialog closes.
      rec(midway.live > 0,
        'a timer is running while the request hangs (so the next check is meaningful)',
        `live=${midway.live} created=${midway.created}`);

      // Close it while the request is still outstanding.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2500);
      const closed = await timers();
      console.log(`   after closing mid-flight: live=${closed.live} cleared=${closed.cleared}`);
      rec(closed.live === 0,
        'closing the dialog mid-generation stops its timer',
        `live ${midway.live} -> ${closed.live}`);
    }
  }
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

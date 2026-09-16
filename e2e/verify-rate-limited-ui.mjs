// What does a rate-limited user actually see?
//
// This surfaced by accident. In a full-suite run the team roster rendered with ZERO rows
// and no filters, while the same script passes 14/14 on its own. The suite runs scripts
// sequentially, so it is not concurrency — it is cumulative load against one shared
// account crossing `THROTTLE_DEFAULT_LIMIT=120` per 60s, and `api()` retries 401 but not
// 429.
//
// That part is my harness's doing, not the app's. But it asked a question nothing has
// tested: when the API answers 429, does the app SAY so, or does it quietly render an
// empty page? An empty roster with no explanation is indistinguishable from "this
// workspace has no members" — the user concludes their data is gone.
//
// 429 is injected directly rather than by hammering, so the check is deterministic and
// does not depend on tripping a real limiter.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const browser = await chromium.launch();
const p = await provision('ratelimit');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);
void mgrId;

// A second member, so a healthy roster has something to lose.
await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);

const until = async (fn, ms = 15000, step = 250) => {
  for (let i = 0; i < Math.ceil(ms / step); i += 1) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
};

// ---- the healthy baseline, so "empty" means something -----------------------
console.log('===== the roster when the API is answering normally');
{
  await visit(page, '/team', 9000);
  const rows = await until(async () => {
    const n = await page.locator('tbody tr').count();
    return n > 0 ? n : null;
  }, 20000);
  console.log(`   roster rows: ${rows}`);
  rec(Boolean(rows), 'the roster lists members when the API is healthy', String(rows));
  rec(await page.locator('[aria-label="Filter members by status"]').count() > 0,
    'and the filters are present', '');
}

// ---- now the API answers 429 ------------------------------------------------
console.log('\n===== the same page when the API answers 429 Too Many Requests');
{
  let hits = 0;
  await page.route(/\/api\/v1\/(workspace_members|team|users)/, async (route) => {
    hits += 1;
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '30' },
      body: JSON.stringify({ error: { message: 'Too many requests', code: 429 } }),
    });
  });

  await visit(page, '/team', 9000);
  await page.waitForTimeout(4000);

  const seen = await page.evaluate(() => {
    const main = (document.querySelector('main')?.innerText || document.body.innerText || '').trim();
    return {
      rows: document.querySelectorAll('tbody tr').length,
      text: main.slice(0, 400),
      // Does anything on screen explain the problem?
      explains: /too many|rate limit|slow down|try again|retry|error|failed|unable|wrong/i.test(main),
      // Or does it assert a fact that is not true?
      claimsEmpty: /no members|no team members|nobody|0 members|empty/i.test(main),
      toasts: Array.from(document.querySelectorAll('[data-sonner-toast]'))
        .map((t) => (t.textContent || '').trim()),
    };
  });

  console.log(`   intercepted ${hits} request(s)`);
  console.log(`   rows: ${seen.rows}  explains: ${seen.explains}  claimsEmpty: ${seen.claimsEmpty}`);
  console.log(`   toasts: ${JSON.stringify(seen.toasts)}`);
  console.log(`   main text: ${JSON.stringify(seen.text.replace(/\n/g, ' | ').slice(0, 220))}`);

  rec(hits > 0, 'the 429 actually reached the page (the interception matched)', String(hits));

  // The real question. Either it explains itself, or it must not assert an untruth.
  rec(seen.explains || seen.toasts.length > 0,
    'a rate-limited page tells the user something went wrong',
    `nothing on screen explains it — text: ${JSON.stringify(seen.text.slice(0, 200))}`);

  rec(!(seen.claimsEmpty && !seen.explains),
    'and does not claim the workspace has no members when it simply could not load them',
    `claimsEmpty=${seen.claimsEmpty} explains=${seen.explains} — "no members" for a workspace `
    + `that has members is a statement the app cannot support`);
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

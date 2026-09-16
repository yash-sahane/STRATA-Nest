// Realtime: one refetch per burst, and never zero when something changed.
//
// The "realtime inefficiency" findings (#139-#143) did NOT reproduce as a
// fan-out problem: per event the cost was already 1 ws frame -> 1 GET, because
// invalidating a query root with no active observer is free. The burst was the
// waste — five writes in a second produced five full list refetches, and a burst
// is the normal case rather than the exception (a teammate reordering a board
// emits one event per card).
//
// Both directions are asserted, because the cheap way to "optimise" this is to
// stop refetching at all:
//   a single write MUST still refetch  (stale data is worse than a wasted GET)
//   a burst must refetch ONCE          (that is the saving)
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };

const browser = await chromium.launch();
const p = await provision('coalesce');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

const ids = [];
for (let i = 1; i <= 6; i += 1) {
  const r = await api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `CO-${i}`,
    title: `Coalesce task ${i}`, status: 'TODO', priority: 'MEDIUM', assigneeIds: [mgrId],
  });
  if (!r.j?.id) throw new Error(`task ${i}: ${r.s} ${r.t.slice(0, 200)}`);
  ids.push(r.j.id);
}

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
const gets = [];
page.on('request', (r) => {
  const u = r.url();
  if (r.method() === 'GET' && u.includes('/api/v1/tasks')) gets.push(u);
});
let frames = 0;
page.on('websocket', (s) => s.on('framereceived', (f) => {
  const d = typeof f.payload === 'string' ? f.payload : '';
  if (d.includes('"event"')) frames += 1;
}));

await visit(page, '/tasks', 8000);
await page.waitForTimeout(5000);
rec(true, 'the task board is loaded and subscribed', `${gets.length} GETs during load`);

// ---- one write still refetches ---------------------------------------------
console.log('===== one remote write');
gets.length = 0;
frames = 0;
await api(mgr, 'PATCH', `/tasks/${ids[0]}`, { title: 'Coalesce task 1 (edited)' });
await page.waitForTimeout(6000);
console.log(`   ${frames} ws frames -> ${gets.length} GETs`);
rec(frames >= 1, 'the write reached the browser over the socket', `${frames} frames`);
rec(gets.length >= 1, 'a single change still refetches — coalescing must not mean ignoring',
  `${gets.length} GETs`);
rec(gets.length <= 2, 'and does not refetch more than necessary', `${gets.length} GETs`);
const body = await page.locator('body').innerText().catch(() => '');
rec(/Coalesce task 1 \(edited\)/.test(body), 'and the new value is actually on screen',
  body.slice(0, 300).replace(/\n/g, ' | '));

// ---- a burst shares one refetch --------------------------------------------
console.log('\n===== five remote writes in quick succession');
gets.length = 0;
frames = 0;
for (let i = 1; i <= 5; i += 1) {
  await api(mgr, 'PATCH', `/tasks/${ids[i]}`, { title: `Coalesce task ${i + 1} (burst)` });
}
await page.waitForTimeout(9000);
const perEvent = gets.length / Math.max(frames, 1);
console.log(`   ${frames} ws frames -> ${gets.length} GETs (${perEvent.toFixed(2)} per event)`);
rec(frames >= 4, 'the burst really did arrive as several events', `${frames} frames`);
rec(gets.length < frames, 'a burst costs fewer refetches than it has events',
  `${gets.length} GETs for ${frames} frames`);
rec(gets.length <= 2, 'in practice one', `${gets.length} GETs`);

// The last write in the burst must still be visible — coalescing on a trailing
// edge is only correct if the final state wins.
const after = await page.locator('body').innerText().catch(() => '');
rec(/Coalesce task 6 \(burst\)/.test(after),
  'and the LAST write in the burst is the one on screen',
  after.slice(0, 400).replace(/\n/g, ' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

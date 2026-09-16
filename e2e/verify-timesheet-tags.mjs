// Time-entry tags were collected and never shown.
//
// The Log Time dialog asks for "Tags (comma-separated)", the DTO accepts them, the
// mapper returns them, and no screen rendered them — so filling the field in was
// busywork. (The other half of that finding, `hourlyRate`, does not exist in this app
// at all: the only reference is a comment in use-analytics suggesting it could be
// added.)
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };

const browser = await chromium.launch();
const p = await provision('tstags');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

const start = new Date(Date.now() - 90 * 60_000).toISOString();
const end = new Date().toISOString();
const entry = await api(dev, 'POST', '/time_entries', {
  workspaceId: p.ws, projectId: p.project,
  description: 'Work with tags on it',
  startTime: start, endTime: end,
  tags: ['refactor', 'pairing'],
});
console.log(`   created: ${entry.s} tags=${JSON.stringify(entry.j?.tags)}`);
rec(entry.s === 201, 'a time entry with tags was created', `${entry.s} ${entry.t.slice(0, 200)}`);
rec(Array.isArray(entry.j?.tags) && entry.j.tags.length === 2,
  'and the API returns them', JSON.stringify(entry.j?.tags));

const { ctx, page } = await signedInPage(browser, 'role.software_developer@strata.local', p.ws);
await visit(page, '/time-tracking', 9000);
const body = await page.locator('body').innerText().catch(() => '');
console.log(`   timesheet mentions the tags: refactor=${/refactor/.test(body)} pairing=${/pairing/.test(body)}`);
rec(/Work with tags on it/.test(body), 'the entry is on the timesheet',
  body.slice(0, 300).replace(/\n/g, ' | '));
rec(/refactor/.test(body) && /pairing/.test(body),
  'and both tags it collected are shown',
  body.slice(0, 600).replace(/\n/g, ' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

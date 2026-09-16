// Every notification this application creates used to lead nowhere.
//
// navigationUrlFor matches SCREAMING_SNAKE throughout, and the server's
// NotifiableEvent map emits snake_case with relatedEntityType to match. Not one of
// the nine real types matched anything — `leave_approved` does not start with
// `LEAVE_`, and 'leave_request' is not 'LEAVE' — so the whole navigation feature was
// dead for real notifications while the entity-type fallback handled only types the
// app never produces.
//
// Each real type is seeded and checked for a named "Open:" action, which is what the
// row offers when it has somewhere to go.
import { chromium, api, adminJar, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 350)}`); };

const browser = await chromium.launch();
const admin = await adminJar();
const p = await provision('notifroute');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const mgrId = await whoami(mgr);

/** The nine types the server's NotifiableEvent map actually emits. */
const REAL = [
  ['workspace_member_added', 'workspace', p.ws],
  ['workspace_role_changed', 'workspace', p.ws],
  ['invitation_accepted', 'workspace', p.ws],
  ['join_request_approved', 'join_request', p.ws],
  ['join_request_rejected', 'join_request', p.ws],
  ['leave_approved', 'leave_request', 'lr-1'],
  ['leave_rejected', 'leave_request', 'lr-2'],
  ['time_entry_approved', 'time_entry', 'te-1'],
  ['time_entry_rejected', 'time_entry', 'te-2'],
];

console.log('===== seeding one notification of each real type');
for (const [type, entityType, entityId] of REAL) {
  const r = await api(admin, 'POST', '/notifications', {
    workspaceId: p.ws,
    userId: mgrId,
    type,
    title: `T ${type}`,
    message: `seeded for ${type}`,
    relatedEntityType: entityType,
    relatedEntityId: entityId,
  });
  if (r.s !== 201) {
    rec(false, `seeded ${type}`, `${r.s} ${r.t.slice(0, 180)}`);
  }
}
rec(true, 'the nine real notification types were seeded', '');

const { ctx, page } = await signedInPage(browser, 'role.manager@strata.local', p.ws);
await visit(page, '/dashboard', 6000);
const bell = page.getByRole('button', { name: /notification/i }).first();
rec(await bell.count() > 0, 'the bell is reachable', String(await bell.count()));
await bell.click();
await page.waitForTimeout(4000);

// For each seeded row, does it offer a named Open action?
const rows = await page.evaluate(() => {
  const panel = document.querySelector('[data-radix-popper-content-wrapper]');
  if (!panel) return [];
  return [...panel.querySelectorAll('.group.relative')].map((r) => ({
    text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    actions: [...r.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? ''),
  }));
});
console.log(`   ${rows.length} rows in the panel`);

for (const [type] of REAL) {
  const row = rows.find((r) => r.text.includes(`T ${type}`));
  if (!row) {
    rec(false, `${type}: the row is in the panel`, JSON.stringify(rows.slice(0, 3)));
    continue;
  }
  const opens = row.actions.some((a) => a.startsWith('Open:'));
  console.log(`   ${type.padEnd(24)} -> ${opens ? 'Open' : JSON.stringify(row.actions)}`);
  rec(opens, `${type} leads somewhere`, JSON.stringify(row.actions));
}

// And activating one actually navigates, rather than merely claiming to.
const leaveRow = page.getByRole('button', { name: /^Open: T leave_approved$/ }).first();
rec(await leaveRow.count() > 0, 'the leave notification offers its Open action', String(await leaveRow.count()));
if (await leaveRow.count()) {
  await leaveRow.click();
  await page.waitForTimeout(4000);
  console.log(`   landed on ${page.url()}`);
  rec(/\/leave/.test(page.url()), 'and activating it reaches /leave', page.url());
}

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

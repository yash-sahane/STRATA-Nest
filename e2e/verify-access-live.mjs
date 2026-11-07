// A change to what somebody may do reaches the screen they are on.
//
//  Everything the interface offers is decided from two cached answers — the
//  caller's memberships, and the definitions of any custom roles they hold —
//  fetched once and trusted for five minutes. So when a manager changed
//  somebody's role, or edited what a role may do, the person it concerned went
//  on seeing the old buttons until the cache happened to expire or they
//  reloaded: pressing ones the API now refused, missing ones it now allowed.
//
//  The page under test is never reloaded.
import { chromium, api, provision, addRole, signedInPage, visit, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 380)}`); };
const brief = (r) => `${r.s} ${String(r.t).slice(0, 220)}`;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

const browser = await chromium.launch();
const p = await provision('accesslive');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const testerId = await whoami(tester);
const membership = list((await api(mgr, 'GET', `/workspace_members?workspaceId=${p.ws}&limit=100`)).j)
  .find((m) => m.userId === testerId);

const { ctx, page, errors } = await signedInPage(browser, 'role.tester@strata.local', p.ws);
await visit(page, '/team', 8000);
const tab = (name) => page.getByRole('tab', { name });
/** Wait, without reloading, for a tab to be there (or gone). */
const settles = async (name, present, ms = 20000) => {
  for (let waited = 0; waited <= ms; waited += 500) {
    if (((await tab(name).count()) > 0) === present) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

console.log('===== a role is changed while its holder is looking');
rec((await tab('Team Members').count()) > 0, 'a tester has the Team page open');
rec((await tab('Add Members').count()) === 0 && (await tab('Join Requests').count()) === 0,
  'and is offered neither Add Members nor Join Requests');
{
  const r = await api(mgr, 'PATCH', `/workspace_members/${membership.id}`, { role: 'MANAGER' });
  rec(r.s === 200, 'a manager makes them a manager', brief(r));
  rec(await settles('Add Members', true) && await settles('Join Requests', true),
    'both appear on the page they already have open',
    (await page.getByRole('tab').allInnerTexts()).join(' | '));
}
{
  const r = await api(mgr, 'PATCH', `/workspace_members/${membership.id}`, { role: 'TESTER' });
  rec(r.s === 200, 'and is made a tester again', brief(r));
  rec(await settles('Add Members', false) && await settles('Join Requests', false),
    'both go again — not five minutes later',
    (await page.getByRole('tab').allInnerTexts()).join(' | '));
}

console.log('===== what a custom role may do is edited');
{
  const role = await api(mgr, 'POST', '/workspace_roles', {
    workspaceId: p.ws, name: 'Observer', permissions: [],
  });
  rec(role.s === 201, 'a custom role with nothing extra is created', brief(role));
  const given = await api(mgr, 'PATCH', `/workspace_members/${membership.id}`, { role: 'Observer' });
  rec(given.s === 200, 'and given to the tester', brief(given));
  rec(await settles('Join Requests', false), 'they still have no Join Requests tab');

  const widened = await api(mgr, 'PATCH', `/workspace_roles/${role.j?.id}`, { permissions: ['join:manage'] });
  rec(widened.s === 200, 'the role is edited to let its holders handle join requests', brief(widened));
  rec(await settles('Join Requests', true),
    'the tab appears for somebody who holds it, on the page they have open',
    (await page.getByRole('tab').allInnerTexts()).join(' | '));
}

rec(errors.length === 0, 'no page threw while any of this ran', errors.join(' | '));

await ctx.close();
await browser.close();
await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

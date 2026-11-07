// Dead ends, as each role meets them.
//
// Every route, every control on it that a person could click, clicked — and the
// question asked of each is the one a user asks: did anything happen?
//
//   dead control     a button, tab or clickable-looking element that changes
//                    nothing: no navigation, no dialog or menu, no change on the
//                    page, no request, no message
//   refused          it did something, and what it did was fail: the server
//                    answered 4xx/5xx, or an error toast appeared. The control was
//                    offered to somebody who may not use it
//   pointer-dead     a pointer cursor over something that has no handler anywhere
//                    up its ancestry — a promise of a click that is not there
//   mouse-only       an element with a click handler that is not a control: no
//                    role, no tab stop, so a keyboard cannot reach what a mouse can
//   no-pointer       an enabled control whose cursor stays an arrow
//   bad link         an internal link to a route the app does not have, to
//                    `undefined`/`null`, or to "#"
//   covered          a control another element sits on top of, so the click lands
//                    on something else
//
// Exploratory: it prints findings and exits 0. `node probe-dead-ends.mjs` for every
// role, `node probe-dead-ends.mjs MANAGER /tasks` for one role and one route.
//
// Read-only by construction where it matters: anything whose name says it saves,
// sends, deletes, approves, starts or stops is listed but never clicked, and
// nothing inside an open dialog's form is submitted.
import { chromium, api, provision, addRole, signedInPage, visit, whoami, BASE } from './kit.mjs';

const [onlyRole, onlyRoute] = process.argv.slice(2);

const ROLES = [
  ['MANAGER', 'role.manager@strata.local'],
  ['TESTER', 'role.tester@strata.local'],
  ['MEMBER', 'role.member@strata.local'],
].filter(([role]) => !onlyRole || role === onlyRole);

// Every route the app has. A link anywhere must land on one of these.
const APP_ROUTES = [
  '/', '/login', '/forgot-password', '/reset-password', '/change-password',
  '/activity', '/analytics', '/analytics/team', '/analytics/workspace', '/attendance', '/attendance/team',
  '/calendar', '/dashboard', '/epics', '/functional-requirements', '/leave', '/onboarding', '/profile',
  '/projects', '/projects/:id', '/projects/:id/settings', '/requirements', '/settings', '/sprints',
  '/sprints/:id/analytics', '/sprints/:id/backlog', '/sprints/:id/board', '/tasks', '/team',
  '/time-tracking', '/workspaces',
].map((r) => new RegExp('^' + r.replace(/:id/g, '[A-Za-z0-9_-]+') + '/?$'));

// Never clicked: these act on their own, without a dialog in between.
const DO_NOT_CLICK = new RegExp(
  '\\b(check ?in|check ?out|clock|start|stop|pause|resume|approve|reject|decline|accept|mark|clear|delete|' +
    'remove|sign ?out|log ?out|complete|archive|restore|regenerate|revoke|deactivate|reactivate|activate|leave workspace|' +
    'withdraw|cancel (request|leave)|submit|sync|disconnect|test connection|copy|download|upload|export|import|save|' +
    'confirm|apply|send|resend|re-?issue|generate|reset|discard|take out|add to sprint|move to|refresh|retry|' +
    'unassign|assign to me|join|request access|switch to|use this)\\b',
  'i',
);

const findings = [];
const seen = new Set();
const note = (kind, role, route, what, detail = '') => {
  const key = `${kind}|${role}|${what}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ kind, role, route, what, detail });
  console.log(`  ${kind.toUpperCase().padEnd(12)} ${role.padEnd(8)} ${route}  ${what}${detail ? `\n               ${detail}` : ''}`);
};

/**
 * Every candidate in the current scope — the open dialog if there is one, else
 * the page's main region, or the layout (sidebar + header) when asked.
 * Each is tagged `data-crawl` so it can be found again for the click.
 */
const SCAN = (scopeKind) => {
  const CONTROL =
    'button, a[href], [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], ' +
    '[role="combobox"], [role="menuitem"], [role="option"], [role="radio"], summary, input, select, textarea, label';
  const reactProps = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    return key ? el[key] : null;
  };
  // A click handler of its own. Pointer-down/up handlers on containers are focus
  // management (Radix roving focus, dismissable layers), not something to click.
  const CONTAINER_ROLES = /^(tablist|toolbar|group|radiogroup|menubar|listbox|menu|tabpanel|dialog|alertdialog|region|presentation|none|grid|tree)$/;
  const hasHandler = (el) => {
    if (CONTAINER_ROLES.test(el.getAttribute('role') || '')) return false;
    const p = reactProps(el);
    return !!(p && p.onClick);
  };
  const anyHandler = (el) => {
    const p = reactProps(el);
    return !!(p && (p.onClick || p.onPointerDown || p.onMouseDown || p.onPointerUp || p.onMouseUp));
  };
  const handledUpward = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (anyHandler(n)) return true;
      if (n !== el && n.matches(CONTROL)) return true;
    }
    return false;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
    return true;
  };
  const name = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim();
      if (t) return t;
    }
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 70);
    return (el.getAttribute('title') || el.querySelector('img')?.alt || el.getAttribute('placeholder') || '').trim();
  };

  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
  let scopes;
  if (scopeKind === 'layout') scopes = [...document.querySelectorAll('aside, header')];
  else if (dialogs.length) scopes = [dialogs[dialogs.length - 1]];
  else scopes = [document.querySelector('main#main-content') ?? document.body];
  const inScope = (el) => scopes.some((s) => s.contains(el));

  document.querySelectorAll('[data-crawl]').forEach((el) => el.removeAttribute('data-crawl'));
  const out = [];
  const add = (el, kind) => {
    const i = out.length;
    el.setAttribute('data-crawl', String(i));
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Covered: the point a click would land on belongs to something else.
    const cx = r.left + Math.min(r.width / 2, 20);
    const cy = r.top + r.height / 2;
    const hit = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
    // Scrolled out of a scrolling container (the sidebar's long list, a dialog's
    // body) is not covered: the point is outside the box that shows it, and the click
    // below scrolls it into view first. Only a control inside every scroller's
    // visible box can be covered.
    let clipped = false;
    for (let up = el.parentElement; up; up = up.parentElement) {
      const ucs = getComputedStyle(up);
      if (!/(auto|scroll|hidden)/.test(ucs.overflowY + ucs.overflowX)) continue;
      const ur = up.getBoundingClientRect();
      if (cx < ur.left || cx > ur.right || cy < ur.top || cy > ur.bottom) { clipped = true; break; }
    }
    out.push({
      i,
      kind,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      name: name(el),
      href: el.getAttribute('href'),
      type: el.getAttribute('type') || '',
      inForm: !!el.closest('form'),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled'),
      cursor: cs.cursor,
      pointerEvents: cs.pointerEvents,
      handler: hasHandler(el),
      handledUpward: handledUpward(el),
      tabbable: el.tabIndex >= 0,
      covered: !clipped && !!(hit && hit !== el && !el.contains(hit) && !hit.contains(el)),
      // A row whose click is a mouse convenience for a named control inside it — the
      // RowActivator/RowLink pattern ("Open task: …") — has its keyboard path there.
      keyboardPath: !!el.querySelector(
        ':is(button, a[href], [role="button"], [role="link"])[aria-label^="Open "], :is(button, a[href], [role="button"])[aria-label^="Select "]',
      ),
      // A chart's own pointer handling (tooltips) is not a control.
      chart: !!(el.closest('.recharts-wrapper') || el.querySelector('.recharts-surface')),
      coveredBy: hit && hit !== el && !el.contains(hit) ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : '',
      onScreen: r.bottom > 0 && r.top < innerHeight,
    });
  };

  for (const el of document.querySelectorAll(CONTROL)) {
    if (!inScope(el) || !visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag) && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) continue;
    if (tag === 'label') continue;
    add(el, 'control');
  }
  // Clickable things that are not controls, and pointer cursors over nothing.
  for (const el of document.querySelectorAll('div, span, li, tr, td, p, img, svg, h1, h2, h3, h4, section, article')) {
    if (!inScope(el) || !visible(el)) continue;
    if (el.closest(CONTROL)) continue;
    const pointer = getComputedStyle(el).cursor === 'pointer';
    const handler = hasHandler(el);
    if (!pointer && !handler) continue;
    // Only the outermost of a pointer/handler run.
    const parent = el.parentElement;
    if (parent && !parent.closest(CONTROL) && (hasHandler(parent) || getComputedStyle(parent).cursor === 'pointer')) continue;
    add(el, handler ? 'handler' : 'pointer');
  }
  return out;
};

/** Start counting changes to the page, ignoring tooltips and live clocks. */
const ARM = () => {
  window.__crawlMuts = 0;
  window.__crawlWhat = [];
  const noisy = window.__crawlNoisy ?? new Set();
  const ignorable = (m) => {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (!t) return true;
    for (const n of noisy) if (n.contains?.(t)) return true;
    if (t.closest?.('[role="tooltip"]')) return true;
    if (m.type === 'attributes') {
      if (m.attributeName === 'data-crawl' || m.attributeName === 'aria-describedby') return true;
      if (m.attributeName === 'data-state') {
        const now = t.getAttribute('data-state');
        if (/delayed-open|instant-open/.test(`${m.oldValue} ${now}`)) return true;
      }
    }
    if (m.type === 'childList') {
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (nodes.length && nodes.every((n) => n.nodeType === 1 && (n.matches?.('[role="tooltip"], [data-radix-popper-content-wrapper]') && n.querySelector?.('[role="tooltip"]')))) return true;
    }
    return false;
  };
  window.__crawlObs?.disconnect();
  window.__crawlObs = new MutationObserver((list) => {
    for (const m of list) {
      if (ignorable(m)) continue;
      window.__crawlMuts += 1;
      if (window.__crawlWhat.length < 3) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        window.__crawlWhat.push(`${m.type}:${m.attributeName ?? ''}@${t?.tagName?.toLowerCase()}`);
      }
    }
  });
  window.__crawlObs.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true,
  });
  window.__crawlActive = document.activeElement;
};

/** Nodes that change on their own (timers, relative times) — measured with nobody touching anything. */
const LEARN_NOISE = async (page) => {
  await page.evaluate(() => {
    window.__crawlNoisy = new Set();
    window.__noiseObs?.disconnect();
    window.__noiseObs = new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t && t !== document.body && t !== document.documentElement) window.__crawlNoisy.add(t.parentElement ?? t);
      }
    });
    window.__noiseObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__noiseObs?.disconnect());
};

const browser = await chromium.launch();
const p = await provision('deadends');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const tester = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
await addRole(p.ws, 'MEMBER', 'role.member@strata.local');
const [mgrId, testerId] = await Promise.all([mgr, tester].map(whoami));

// ---- something on every screen ----------------------------------------------------
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return local(d); };
const seed = async (label, call) => {
  const r = await call;
  if (r.s >= 300) console.log(`   seed ${label}: ${r.s} ${String(r.t).slice(0, 160)}`);
  return r.j;
};
const cr = await seed('client requirement', api(mgr, 'POST', '/client_requirements', {
  workspaceId: p.ws, projectId: p.project, title: 'Online ordering', description: 'The client wants orders taken online', priority: 'HIGH', clientName: 'QA Client',
}));
const epic = await seed('epic', api(mgr, 'POST', '/epics', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'DE-E-01', name: 'Ordering epic', requirementId: cr?.id,
}));
const sprint = await seed('sprint', api(mgr, 'POST', '/sprints', {
  workspaceId: p.ws, projectId: p.project, name: 'Crawl Sprint', goal: 'Take orders', startDate: day(0), endDate: day(10),
}));
const fr = await seed('functional requirement', api(mgr, 'POST', '/functional_requirements', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'DE-FR-01', title: 'Place an order', description: 'A customer places an order',
  epicId: epic?.id, clientRequirementId: cr?.id, sprintId: sprint?.id, priority: 'HIGH',
}));
const tasks = [];
for (const [i, status, who, due] of [[1, 'TODO', testerId, 2], [2, 'IN_PROGRESS', testerId, -1], [3, 'REVIEW', mgrId, 5], [4, 'TODO', mgrId, 0]]) {
  tasks.push(await seed(`task ${i}`, api(mgr, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: `DE-T-0${i}`, title: `Crawl task ${i}`, status: 'TODO', priority: 'MEDIUM',
    assigneeIds: [who], dueDate: day(due), functionalRequirementId: fr?.id, epicId: epic?.id, sprintId: sprint?.id,
  })));
  if (status !== 'TODO') for (const s of status === 'REVIEW' ? ['IN_PROGRESS', 'REVIEW'] : ['IN_PROGRESS']) {
    await api(mgr, 'PATCH', `/tasks/${tasks.at(-1)?.id}`, { status: s });
  }
}
await seed('sprint start', api(mgr, 'PATCH', `/sprints/${sprint?.id}`, { status: 'ACTIVE' }));
await seed('comment', api(tester, 'POST', '/task_comments', { taskId: tasks[0]?.id, content: 'Looking at this now' }));
{
  // A working day two weeks out: a weekend has no working days to take off.
  let offset = 14;
  while ([0, 6].includes(new Date(Date.now() + offset * 864e5).getDay())) offset += 1;
  await seed('leave', api(tester, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: day(offset), endDate: day(offset), reason: 'Family visit',
  }));
}
{
  const now = Date.now();
  await seed('time entry', api(tester, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, taskId: tasks[0]?.id, description: 'Investigation',
    startTime: new Date(now - 90 * 60e3).toISOString(), endTime: new Date(now - 30 * 60e3).toISOString(),
  }));
}

const ROUTES = [
  '/dashboard', '/projects', `/projects/${p.project}`, `/projects/${p.project}/settings`,
  `/requirements?projectId=${p.project}`, `/epics?projectId=${p.project}`, `/functional-requirements?projectId=${p.project}`,
  `/tasks?projectId=${p.project}`, '/sprints', `/sprints/${sprint?.id}/backlog`, `/sprints/${sprint?.id}/board`,
  `/sprints/${sprint?.id}/analytics`, '/calendar', '/analytics', '/activity', '/attendance', '/attendance/team', '/leave',
  '/time-tracking', '/team', '/workspaces', '/settings', '/profile',
  // The detail dialogs, opened by their own URLs.
  `/tasks?projectId=${p.project}&taskId=${tasks[0]?.id}`,
  `/functional-requirements?projectId=${p.project}&frId=${fr?.id}`,
  `/requirements?projectId=${p.project}&crId=${cr?.id}`,
  `/epics?projectId=${p.project}&epicId=${epic?.id}`,
].filter((r) => !onlyRoute || r.startsWith(onlyRoute));

const checkLink = (role, route, c) => {
  const href = c.href ?? '';
  if (href === '' || href === '#' || /^javascript:/i.test(href)) {
    note('bad link', role, route, `"${c.name}" goes nowhere (href="${href}")`);
    return;
  }
  if (/\b(undefined|null|NaN)\b/.test(href)) {
    note('bad link', role, route, `"${c.name}" -> ${href}`);
    return;
  }
  if (/^(mailto:|tel:)/.test(href)) return;
  let url;
  try { url = new URL(href, BASE); } catch { note('bad link', role, route, `"${c.name}" unparsable ${href}`); return; }
  if (url.origin !== new URL(BASE).origin) return;
  if (!APP_ROUTES.some((re) => re.test(url.pathname))) note('bad link', role, route, `"${c.name}" -> ${url.pathname} (no such route)`);
};

const judgeStatic = (role, route, list) => {
  for (const c of list) {
    if (c.kind === 'pointer' && !c.handledUpward) note('pointer-dead', role, route, `<${c.tag}> "${c.name}" shows a pointer and has no handler`);
    if (c.kind === 'handler' && !c.tabbable && !c.keyboardPath && !c.chart) note('mouse-only', role, route, `<${c.tag}> "${c.name}" has a click handler, no role and no tab stop`);
    if (c.kind === 'control' && !c.disabled && c.cursor !== 'pointer' && !['input', 'textarea'].includes(c.tag)) {
      note('no-pointer', role, route, `<${c.tag}${c.role ? ` role=${c.role}` : ''}> "${c.name}" cursor:${c.cursor}`);
    }
    if (c.kind === 'control' && c.disabled && c.cursor === 'pointer' && c.pointerEvents !== 'none') {
      note('no-pointer', role, route, `disabled <${c.tag}> "${c.name}" still shows a pointer`);
    }
    if (c.covered && c.onScreen && !c.disabled) note('covered', role, route, `"${c.name}" is under ${c.coveredBy}`);
    if (c.tag === 'a' || c.role === 'link') checkLink(role, route, c);
  }
};

/** Should this candidate be clicked? */
const clickable = (c) => {
  if (c.disabled) return false;
  if (c.tag === 'a' && c.href && c.href !== '#') return false; // links are judged by where they go
  if (c.tag === 'input' || c.tag === 'select') return false;
  if (['checkbox', 'switch', 'radio', 'option', 'menuitem'].includes(c.role)) return false;
  if (c.type === 'submit' || (c.inForm && c.tag === 'button' && c.type !== 'button')) return false;
  if (DO_NOT_CLICK.test(c.name)) return false;
  if (c.kind === 'pointer' && !c.handledUpward) return false; // already reported
  return true;
};

const sameRoute = (page, route) => {
  const now = new URL(page.url());
  const want = new URL(route, BASE);
  return now.pathname === want.pathname;
};

async function crawl(role, email) {
  console.log(`\n===== ${role}`);
  const { ctx, page, errors } = await signedInPage(browser, email, p.ws);
  const requests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/webpack-hmr|__nextjs|_next\/static\/webpack|\/favicon/.test(u)) return;
    requests.push({ at: Date.now(), u, m: r.method() });
  });
  // A file picker opens outside the page — no mutation, request or toast — so it
  // is listened for: "Change Avatar" and "Attach files" open one, and are not dead.
  let chooserAt = 0;
  page.on('filechooser', () => { chooserAt = Date.now(); });
  const responses = [];
  let limited = 0;
  page.on('response', (r) => {
    if (!r.url().startsWith('http://localhost:8000')) return;
    // 429 is the dev stack's shared rate limit, not the control: counted, not judged.
    if (r.status() === 429) { limited += 1; return; }
    if (r.status() >= 400) responses.push({ at: Date.now(), s: r.status(), u: r.url() });
  });

  const tryOne = async (route, scopeKind, c, list) => {
    const target = page.locator(`[data-crawl="${c.i}"]`);
    if (!(await target.count())) return 'gone';
    try { await target.scrollIntoViewIfNeeded({ timeout: 2000 }); await target.hover({ timeout: 2000 }); } catch { return 'unhoverable'; }
    await page.waitForTimeout(350);
    const before = page.url();
    await page.evaluate(ARM);
    await page.evaluate(() => { window.__crawlToasts = document.querySelectorAll('[data-sonner-toast]').length; });
    const t0 = Date.now();
    try {
      await target.click({ timeout: 2500, noWaitAfter: true });
    } catch (e) {
      note('covered', role, route, `"${c.name}" could not be clicked: ${String(e.message).split('\n')[0].slice(0, 120)}`);
      return 'error';
    }
    await page.waitForTimeout(900);
    const after = page.url();
    const state = await page.evaluate(() => ({
      muts: window.__crawlMuts ?? 0,
      what: window.__crawlWhat ?? [],
      toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => (t.textContent || '').slice(0, 140)),
      toastCount: document.querySelectorAll('[data-sonner-toast]').length - (window.__crawlToasts ?? 0),
      focusMoved: document.activeElement !== window.__crawlActive && document.activeElement !== document.body
        && !document.activeElement?.hasAttribute?.('data-crawl'),
    })).catch(() => ({ muts: 1, what: ['navigated'], toasts: [], toastCount: 0, focusMoved: false }));
    const sent = requests.filter((r) => r.at >= t0);
    const refused = responses.filter((r) => r.at >= t0);
    const moved = after !== before;
    if (refused.length) {
      note('refused', role, route, `"${c.name}" -> ${refused.map((r) => `${r.s} ${r.u.replace('http://localhost:8000/api/v1', '')}`).join(', ').slice(0, 200)}`);
    }
    const errorToast = state.toastCount > 0 && state.toasts.find((t) => /fail|error|couldn.t|cannot|can.t|not allowed|permission|denied|forbidden/i.test(t));
    if (errorToast) note('refused', role, route, `"${c.name}" -> toast "${errorToast}"`);
    const choseFile = chooserAt >= t0;
    if (!moved && state.muts === 0 && sent.length === 0 && state.toastCount <= 0 && !state.focusMoved && !choseFile) {
      note('dead control', role, route, `<${c.tag}${c.role ? ` role=${c.role}` : ''}> "${c.name}" (${scopeKind}) — nothing happened`);
    }
    return moved ? 'moved' : 'stayed';
  };

  const reset = async (route) => {
    await visit(page, route, 1800);
    await LEARN_NOISE(page);
  };

  const crawlScope = async (route, scopeKind, limit = 45) => {
    await reset(route);
    let list = await page.evaluate(SCAN, scopeKind);
    judgeStatic(role, route, list);
    const targets = list.filter(clickable).slice(0, limit);
    console.log(`   ${route} (${scopeKind}): ${list.length} candidates, clicking ${targets.length}`);
    const skipped = list.filter((c) => !clickable(c) && !c.disabled && DO_NOT_CLICK.test(c.name)).map((c) => c.name);
    if (skipped.length) console.log(`   ${route} (${scopeKind}): not clicked, by name: ${[...new Set(skipped)].slice(0, 12).join(' | ')}`);
    for (const wanted of targets) {
      // Find it again in a fresh scan if the page was reset since.
      list = await page.evaluate(SCAN, scopeKind);
      const sameName = list.filter((c) => c.name === wanted.name && c.tag === wanted.tag && c.role === wanted.role);
      const nth = targets.filter((t) => t.name === wanted.name && t.tag === wanted.tag && t.role === wanted.role).indexOf(wanted);
      const c = sameName[nth] ?? sameName[0];
      if (!c) continue;
      const outcome = await tryOne(route, scopeKind, c, list);
      // Back to a clean page for the next one.
      const overlay = await page.locator('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]').count();
      if (outcome === 'moved' || !sameRoute(page, route) || overlay) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(250);
        const still = await page.locator('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]').count();
        if (outcome === 'moved' || !sameRoute(page, route) || still || route.includes('Id=')) await reset(route);
      }
    }
  };

  // The sidebar and header once — they are the same on every page.
  if (!onlyRoute) await crawlScope('/dashboard', 'layout', 40);
  for (const route of ROUTES) {
    const started = Date.now();
    const limitedBefore = limited;
    await crawlScope(route, 'page');
    console.log(`   ${route} done in ${Math.round((Date.now() - started) / 1000)}s${limited > limitedBefore ? ` (${limited - limitedBefore} rate-limited responses)` : ''}`);
  }
  if (errors.length) note('page error', role, '(any)', errors.slice(0, 3).join(' | '));
  await ctx.close();
}

for (const [role, email] of ROLES) await crawl(role, email);
await browser.close();
await p.cleanup();

console.log(`\n${'#'.repeat(72)}\n${findings.length} findings`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n${kind} (${list.length})`);
  for (const f of list) console.log(`  ${f.role.padEnd(8)} ${f.route.replace(/[A-Za-z0-9]{20}/g, ':id')}  ${f.what}${f.detail ? ` — ${f.detail}` : ''}`);
}

// Proof for the data-integrity criticals: attendance forgery, an approved time
// entry rewritten under its approval, the double-debited leave approval, and
// the two bare 500s (emoji project name, out-of-range epic year).
import { api, adminJar, provision, addRole, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 260)}`); };

const p = await provision('intg');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const am = await addRole(p.ws, 'ASSISTANT_MANAGER', 'role.assistant_manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
const devId = await whoami(dev);

// ---- 1. attendance is evidence, not a draft --------------------------------
console.log('===== attendance cannot be rewritten by its subject');
{
  const ci = await api(dev, 'POST', '/attendance/check-in', { workspaceId: p.ws });
  rec(ci.s === 201 || ci.s === 200, 'the developer can check in', `${ci.s} ${ci.t.slice(0, 140)}`);
  const id = ci.j?.id;
  const before = { status: ci.j?.status, lateMinutes: ci.j?.lateMinutes };
  console.log(`   server computed: status=${before.status} lateMinutes=${before.lateMinutes}`);

  for (const [field, body] of [
    ['status', { status: 'PRESENT' }],
    ['lateMinutes', { lateMinutes: 0 }],
    ['workHours', { workHours: 9 }],
    ['checkOutTime', { checkOutTime: new Date().toISOString() }],
  ]) {
    const r = await api(dev, 'PATCH', `/attendance/${id}`, body);
    rec(r.s === 403, `the subject cannot rewrite ${field}`, `expected 403, got ${r.s} ${r.t.slice(0, 160)}`);
  }

  const soft = await api(dev, 'PATCH', `/attendance/${id}`, { notes: 'stuck in traffic', location: 'Pune' });
  rec(soft.s === 200, 'but CAN still annotate their own day (notes/location)', `${soft.s} ${soft.t.slice(0, 160)}`);
  rec(soft.j?.notes === 'stuck in traffic', 'and the annotation is stored', JSON.stringify(soft.j?.notes));

  const del = await api(dev, 'DELETE', `/attendance/${id}`);
  rec(del.s === 403, 'the subject cannot delete the day and start over', `expected 403, got ${del.s} ${del.t.slice(0, 160)}`);

  const after = await api(dev, 'GET', `/attendance/${id}`);
  rec(after.j?.status === before.status && after.j?.lateMinutes === before.lateMinutes,
    'the server-computed figures survived every attempt',
    `${after.j?.status}/${after.j?.lateMinutes} vs ${before.status}/${before.lateMinutes}`);

  const byMgr = await api(mgr, 'PATCH', `/attendance/${id}`, { status: 'PRESENT', lateMinutes: 0 });
  rec(byMgr.s === 200, 'an HR manager CAN correct the record — the fix did not over-reach', `${byMgr.s} ${byMgr.t.slice(0, 160)}`);
  const mgrDel = await api(mgr, 'DELETE', `/attendance/${id}`);
  rec(mgrDel.s === 204 || mgrDel.s === 200, 'and can delete it', String(mgrDel.s));
}

// ---- 2. an approval cannot outlive the figures it approved ------------------
console.log('\n===== an approved time entry re-opens when it is edited');
{
  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date().toISOString();
  const e = await api(dev, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, description: 'real work',
    startTime: start, endTime: end, duration: 90,
  });
  rec(e.s === 201, 'the developer logs an entry', `${e.s} ${e.t.slice(0, 160)}`);
  const id = e.j?.id;

  const ap = await api(mgr, 'POST', `/time_entries/${id}/approve`);
  rec(ap.s === 201 || ap.s === 200, 'the manager approves it', `${ap.s} ${ap.t.slice(0, 160)}`);
  rec(ap.j?.status === 'APPROVED', 'it reads APPROVED', String(ap.j?.status));
  const approver = ap.j?.approvedBy;

  const edit = await api(dev, 'PATCH', `/time_entries/${id}`, { duration: 99999, description: 'edited after approval' });
  rec(edit.s === 200, 'the owner can still correct it', `${edit.s} ${edit.t.slice(0, 160)}`);
  rec(edit.j?.status === 'PENDING', 'but the edit RE-OPENS it — the approval does not survive', String(edit.j?.status));
  rec(!edit.j?.approvedBy, 'the approver name is cleared', JSON.stringify(edit.j?.approvedBy));
  rec(!edit.j?.approvedAt, 'and so is the approval timestamp', JSON.stringify(edit.j?.approvedAt));
  console.log(`   was approved by ${approver}, now ${JSON.stringify(edit.j?.approvedBy)}`);

  const again = await api(mgr, 'POST', `/time_entries/${id}/approve`);
  rec(again.s === 201 || again.s === 200, 'the manager can approve the NEW figures', `${again.s} ${again.t.slice(0, 160)}`);

  // An hour of its own, before the first entry: the API now refuses an entry that
  // overlaps one the same person already logged (it would count that time twice).
  const e2 = await api(dev, 'POST', '/time_entries', {
    workspaceId: p.ws, projectId: p.project, description: 'race',
    startTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
    endTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
    duration: 30,
  });
  const r2 = await Promise.all([
    api(mgr, 'POST', `/time_entries/${e2.j.id}/approve`),
    api(am, 'POST', `/time_entries/${e2.j.id}/approve`),
  ]);
  const okCount = r2.filter((r) => r.s < 300).length;
  rec(okCount === 1, 'two simultaneous approvals: exactly one wins', r2.map((r) => r.s).join(','));
}

// ---- 3. leave is debited exactly once ---------------------------------------
console.log('\n===== a leave day is debited exactly once, whoever clicks first');
{
  const year = new Date().getUTCFullYear();
  const balOf = async () => {
    const b = await api(mgr, 'GET', `/leave_balances?workspaceId=${p.ws}&userId=${devId}&year=${year}`);
    return b.j?.items?.[0]?.paidLeave;
  };
  const d = new Date(Date.now() + 45 * 86400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  const day = d.toISOString().slice(0, 10);

  const req = await api(dev, 'POST', '/leave_requests', {
    workspaceId: p.ws, type: 'CASUAL', startDate: day, endDate: day, reason: 'concurrency probe',
  });
  rec(req.s === 201, 'the developer submits a one-day request', `${req.s} ${req.t.slice(0, 200)}`);
  const id = req.j?.id;
  const start = await balOf();
  console.log(`   balance before: ${start}`);

  const both = await Promise.all([
    api(mgr, 'POST', `/leave_requests/${id}/approve`),
    api(am, 'POST', `/leave_requests/${id}/approve`),
  ]);
  const wins = both.filter((r) => r.s < 300).length;
  rec(wins === 1, 'exactly ONE approval succeeds',
    both.map((r) => `${r.s}:${String(r.j?.error?.message ?? r.j?.message ?? '').slice(0, 40)}`).join(' | '));

  const afterApprove = await balOf();
  rec(afterApprove === start - 1, 'the balance drops by exactly one day', `${start} -> ${afterApprove}`);

  const cancel = await api(dev, 'POST', `/leave_requests/${id}/cancel`);
  rec(cancel.s < 300, 'the developer cancels it', `${cancel.s} ${cancel.t.slice(0, 160)}`);
  const afterCancel = await balOf();
  rec(afterCancel === start, 'and the full day comes back — no silent loss', `${start} -> ${afterApprove} -> ${afterCancel}`);
}

// ---- 4. no bare 500s --------------------------------------------------------
console.log('\n===== emoji and impossible dates get an answer, not a 500');
{
  const admin = await adminJar();
  const names = ['\u{1F680} Launch Pad', 'Rocket \u{1F680} Launch', 'Рокет 项目 \u{1F680}'];
  for (const name of names) {
    const r = await api(admin, 'POST', '/projects', {
      workspaceId: p.ws, name, shortCode: 'EMJ', clientName: 'Acme',
    });
    rec(r.s === 201, `a project named "${name}" is created`, `${r.s} ${r.t.slice(0, 160)}`);
    rec(r.j?.name === name, 'and the emoji survives intact in the stored name', JSON.stringify(r.j?.name));
    if (r.j?.id) await api(admin, 'DELETE', `/projects/${r.j.id}?cascade=true`);
  }

  // the exact broken payload the old client generated: half a rocket
  const lone = await api(admin, 'POST', '/projects', {
    workspaceId: p.ws, name: 'Rocket Launch', shortCode: 'R\uD83DL', clientName: 'Acme',
  });
  rec(lone.s < 500, 'a lone surrogate in shortCode no longer 500s', `${lone.s} ${lone.t.slice(0, 200)}`);
  if (lone.j?.id) {
    rec(!/[\uD800-\uDFFF]/.test(lone.j.shortCode ?? ''), 'the stored code has no surrogate half', JSON.stringify(lone.j?.shortCode));
    await api(admin, 'DELETE', `/projects/${lone.j.id}?cascade=true`);
  }

  const dateCases = [
    ['year 20265', { startDate: '20265-06-07' }],
    ['year 12345', { startDate: '12345-06-07' }],
    ['nonsense', { startDate: 'not-a-date' }],
    ['year 0001', { startDate: '0001-01-01' }],
  ];
  for (const [label, body] of dateCases) {
    const r = await api(admin, 'POST', '/epics', {
      workspaceId: p.ws, projectId: p.project, hierarchyId: `E-${label.replace(/\W/g, '')}`,
      name: 'Date probe', ...body,
    });
    rec(r.s === 400, `Create Epic with ${label} is refused with 400, not 500`, `${r.s} ${r.t.slice(0, 200)}`);
    const msg = JSON.stringify(r.j?.error?.message ?? r.j?.message ?? r.t);
    rec(/date/i.test(msg), '  ...and the message names the date field', msg.slice(0, 200));
  }

  const good = await api(admin, 'POST', '/epics', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'E-OK', name: 'Real epic',
    startDate: '2026-06-07', endDate: '2026-09-07',
  });
  rec(good.s === 201, 'a real date range still works — the fix did not over-reach', `${good.s} ${good.t.slice(0, 200)}`);

  const task = await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'T-DATE', title: 'due date probe', dueDate: '99999-01-01',
  });
  rec(task.s === 400, 'the same guard covers a task due date', `${task.s} ${task.t.slice(0, 200)}`);
  const clear = await api(admin, 'POST', '/tasks', {
    workspaceId: p.ws, projectId: p.project, hierarchyId: 'T-DATE2', title: 'no due date', dueDate: '',
  });
  rec(clear.s === 201, 'an empty due date still means "none" rather than an error', `${clear.s} ${clear.t.slice(0, 200)}`);
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

// Proof for the three critical security fixes: comment authorship, the realtime
// payload leak, and inline-served uploads.
import { api, adminJar, getJar, whoami, provision, addRole, FIXTURES } from './kit.mjs';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 220)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const p = await provision('sec');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
const dev = await addRole(p.ws, 'SOFTWARE_DEVELOPER', 'role.software_developer@strata.local');
// A colleague with no say over the work (no task:write): the one a comment's
// authorship protects it from. A manager may take a comment down — not rewrite
// it — and that is verify-data-rules.mjs.
const peer = await addRole(p.ws, 'TESTER', 'role.tester@strata.local');
const devId = await whoami(dev);

const task = (await api(p.admin, 'POST', '/tasks', {
  workspaceId: p.ws, projectId: p.project, hierarchyId: 'SEC1', title: 'security probe', status: 'TODO',
})).j;

// ---- 1. comment authorship -------------------------------------------------
console.log('===== comment authorship is enforced by the API');
{
  const mine = await api(dev, 'POST', '/task_comments', { taskId: task.id, content: 'written by the developer' });
  rec(mine.s === 201, 'the developer can post their own comment', `${mine.s} ${mine.t.slice(0, 120)}`);
  const id = mine.j?.id;

  const edit = await api(mgr, 'PATCH', `/task_comments/${id}`, { content: 'rewritten by someone else' });
  rec(edit.s === 403, 'ANOTHER member cannot rewrite it', `expected 403, got ${edit.s} ${edit.t.slice(0, 140)}`);

  const del = await api(peer, 'DELETE', `/task_comments/${id}`);
  rec(del.s === 403, 'ANOTHER member cannot delete it', `expected 403, got ${del.s} ${del.t.slice(0, 140)}`);

  const still = await api(dev, 'GET', `/task_comments?taskId=${task.id}&pageSize=20`);
  const row = (still.j?.items ?? []).find((c) => c.id === id);
  rec(row?.content === 'written by the developer', 'the original text is intact', JSON.stringify(row?.content));

  const own = await api(dev, 'PATCH', `/task_comments/${id}`, { content: 'edited by its author' });
  rec(own.s === 200, 'the AUTHOR can still edit it', `${own.s} ${own.t.slice(0, 120)}`);
  const ownDel = await api(dev, 'DELETE', `/task_comments/${id}`);
  rec(ownDel.s === 204 || ownDel.s === 200, 'the AUTHOR can still delete it', String(ownDel.s));
}

// ---- 2. the realtime payload no longer carries comment text ----------------
console.log('\n===== a comment does not broadcast its text to unrelated sockets');
{
  // An outsider: a real account that is NOT a member of this workspace.
  const outsider = await getJar('role.content_engineer@strata.local');
  const cookie = [...outsider].map(([k, v]) => `${k}=${v}`).join('; ');
  const frames = [];
  const ws = new WebSocket('ws://localhost:8000/ws/collections/', { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(res, 5000); });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch {} });
  ws.send(JSON.stringify({ action: 'subscribe', channels: ['task_comments'] }));
  await wait(1200);

  const secret = 'SECRET-COMMENT-TEXT-' + Math.floor(Date.now() % 100000);
  await api(dev, 'POST', '/task_comments', { taskId: task.id, content: secret });
  await wait(4000);

  const commentFrames = frames.filter((f) => String(f.event || '').startsWith('task_comments'));
  const leaked = JSON.stringify(frames).includes(secret);
  console.log(`   outsider received ${frames.length} frames (${commentFrames.length} on task_comments)`);
  rec(!leaked, 'the comment TEXT never reaches an outsider socket',
    `payload seen: ${JSON.stringify(commentFrames.slice(0, 2)).slice(0, 240)}`);
  if (commentFrames.length) {
    const keys = Object.keys(commentFrames[0].payload ?? {});
    rec(!keys.includes('content'), 'the frame payload carries no content field', JSON.stringify(keys));
  }
  ws.close();
}

// ---- 3. uploads are inert when served back ---------------------------------
console.log('\n===== an uploaded SVG cannot execute on the API origin');
{
  const svg = readFileSync(`${FIXTURES}/logo.svg`);
  const form = new FormData();
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg');
  form.append('workspaceId', p.ws);
  form.append('projectId', p.project);
  form.append('name', 'logo.svg');
  const cookie = [...p.admin].map(([k, v]) => `${k}=${v}`).join('; ');
  const up = await fetch('http://localhost:8000/api/v1/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
  const upBody = await up.text();
  rec(up.status === 201 || up.status === 200, 'the SVG uploads', `${up.status} ${upBody.slice(0, 160)}`);
  let fileId = null;
  try { fileId = JSON.parse(upBody).id; } catch {}

  if (fileId) {
    for (const route of ['view', 'download']) {
      const r = await fetch(`http://localhost:8000/api/v1/files/${fileId}/${route}`, { headers: { Cookie: cookie } });
      const ct = r.headers.get('content-type') || '';
      const cd = r.headers.get('content-disposition') || '';
      const nosniff = r.headers.get('x-content-type-options') || '';
      console.log(`   /${route}: type=${ct} disposition=${cd.slice(0, 40)} nosniff=${nosniff}`);
      rec(!/svg/i.test(ct), `/${route} does not serve it as image/svg+xml`, ct);
      rec(/attachment/.test(cd), `/${route} forces a download rather than inline render`, cd);
      rec(nosniff === 'nosniff', `/${route} sets X-Content-Type-Options: nosniff`, nosniff);
    }
    // a legitimate image must still render inline
    const jpg = readFileSync(`${FIXTURES}/mockup.jpg`);
    const f2 = new FormData();
    f2.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'mockup.jpg');
    f2.append('workspaceId', p.ws); f2.append('projectId', p.project); f2.append('name', 'mockup.jpg');
    const up2 = await fetch('http://localhost:8000/api/v1/files', { method: 'POST', headers: { Cookie: cookie }, body: f2 });
    const id2 = (await up2.json().catch(() => ({}))).id;
    if (id2) {
      const r2 = await fetch(`http://localhost:8000/api/v1/files/${id2}/view`, { headers: { Cookie: cookie } });
      rec(/inline/.test(r2.headers.get('content-disposition') || ''), 'a real JPEG still shows inline — the fix did not over-reach',
        r2.headers.get('content-disposition') || '');
      rec(/image\/jpeg/.test(r2.headers.get('content-type') || ''), 'and keeps its real content type',
        r2.headers.get('content-type') || '');
    }
  }
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));

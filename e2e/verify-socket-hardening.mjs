// Two realtime defects found on 2026-11-06, checked against the running stack.
//
// 1. One anonymous WebSocket handshake took the whole API down. The socket
//    authenticates from the `strata_access` cookie; a value that is not valid
//    percent-encoding ("%") made decodeURIComponent throw inside the handshake,
//    Nest drops that promise, and Node exits on an unhandled rejection. The API
//    stayed down (the compose service has no restart policy).
//
// 2. Integration rows went out over the socket whole. The write hook broadcast the
//    raw row — the Discord webhook URL in plaintext, the GitHub/GitLab token and
//    webhook secret as ciphertext — to any member subscribed to the channel, and
//    subscribing is not authorised per channel. A read-only member could lift the
//    webhook URL from devtools. Audit rows did the same with the HR details the
//    REST read narrows to the people concerned.
import { api, provision, addRole, API } from './kit.mjs';
import WebSocket from 'ws';

const out = [];
const rec = (ok, n, d = '') => {
  out.push([ok, n]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + String(d).slice(0, 240)}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => {
  try {
    return (await fetch(`${API}/health`)).status;
  } catch {
    return 0;
  }
};
const SOCKET = 'ws://localhost:8000/ws/collections/';

// ---- 1. a malformed cookie is refused, and the server survives it ----------
console.log('===== a handshake with a cookie that does not decode is refused, not fatal');
for (const cookie of ['strata_access=%', 'strata_access=%E0%A4%A', 'strata_access=%%%zz']) {
  const closedWith = await new Promise((resolve) => {
    const ws = new WebSocket(SOCKET, { headers: { Cookie: cookie } });
    ws.on('close', (code) => resolve(code));
    ws.on('error', (err) => resolve(`error: ${err.message}`));
    setTimeout(() => resolve('no close within 5s'), 5000);
  });
  rec(closedWith === 4401, `${JSON.stringify(cookie)} is refused with 4401`, String(closedWith));
  await wait(600);
  const status = await health();
  rec(status === 200, '...and the API still answers afterwards', `health ${status}`);
  if (status !== 200) {
    console.log('   the API is down — the remaining checks cannot run');
    process.exitCode = 1;
    process.exit();
  }
}

// ---- 2. integration and audit frames carry the id and nothing else ---------
console.log('\n===== a read-only member gets "something changed", never the credential');
const p = await provision('sockhard');
try {
  const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
  const member = await addRole(p.ws, 'MEMBER', 'role.member@strata.local');

  const frames = [];
  const ws = new WebSocket(SOCKET, {
    headers: { Cookie: [...member].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(resolve, 5000);
  });
  ws.on('message', (data) => {
    try {
      frames.push(JSON.parse(String(data)));
    } catch {
      /* not a frame */
    }
  });
  ws.send(JSON.stringify({ action: 'subscribe', channels: ['discord_integrations', 'activity_logs'] }));
  await wait(1200);

  const secret = `SECRET${Date.now()}`;
  const webhookUrl = `https://discord.com/api/webhooks/123456789012345678/${secret}`;
  const created = await api(mgr, 'POST', '/discord_integrations', { projectId: p.project, webhookUrl });
  rec(created.s === 201 || created.s === 200, 'the manager connects a Discord channel', `${created.s} ${created.t.slice(0, 160)}`);

  const changed = await api(mgr, 'PATCH', `/discord_integrations/${created.j?.id}`, {
    webhookUrl: `${webhookUrl}-rotated`,
  });
  rec(changed.s === 200, '...and rotates its webhook', `${changed.s} ${changed.t.slice(0, 160)}`);
  await wait(3500);

  const integrationFrames = frames.filter((f) => String(f.event || '').startsWith('discord_integrations'));
  const auditFrames = frames.filter((f) => String(f.event || '').startsWith('activity_logs'));
  console.log(`   member received ${integrationFrames.length} integration and ${auditFrames.length} audit frames`);

  rec(integrationFrames.length > 0, 'the member is still told the integration changed (a frame arrives)',
    'no discord_integrations frame at all — the fix must strip the payload, not drop the frame');
  rec(!JSON.stringify(frames).includes(secret), 'the webhook URL never reaches the member',
    JSON.stringify(integrationFrames.slice(0, 2)).slice(0, 240));
  const extraKeys = (list) =>
    list.flatMap((f) => Object.keys(f.payload ?? {})).filter((k) => k !== 'id');
  rec(extraKeys(integrationFrames).length === 0, 'an integration frame carries the id alone',
    JSON.stringify(extraKeys(integrationFrames)));
  rec(extraKeys(auditFrames).length === 0, 'an audit frame carries the id alone',
    JSON.stringify(extraKeys(auditFrames)));

  // The REST read is still the way to see what changed, for those allowed to.
  const listed = await api(mgr, 'GET', `/discord_integrations?projectId=${p.project}`);
  rec(listed.s === 200 && !listed.t.includes(secret), 'the REST read never echoes the webhook URL either',
    `${listed.s} ${listed.t.slice(0, 200)}`);

  ws.close();
} finally {
  await p.cleanup();
}

// The suite reads this exact line; any other wording is recorded as a crash.
const bad = out.filter(([ok]) => !ok);
console.log(`\n===== total ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
if (bad.length) process.exitCode = 1;

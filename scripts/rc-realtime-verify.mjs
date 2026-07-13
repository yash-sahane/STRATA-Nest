// Live realtime verification: connect a real WS client, subscribe to the
// HR collections, trigger real writes through the running
// Nest API, and confirm frames actually arrive. Run with the api+worker already
// running against the live stack (see docs/release/REALTIME_VERIFICATION.md).
import WebSocket from 'ws';

const API = 'http://127.0.0.1:8000/api/v1';
const WS_URL = 'ws://127.0.0.1:8000/ws/collections/';
const EMAIL = 'loadtest@example.test';
const PASSWORD = 'LoadTest-Pass!1';

const WORKSPACE_ID = process.argv[2];
if (!WORKSPACE_ID) {
  console.error('usage: node rc-realtime-verify.mjs <workspaceId>');
  process.exit(1);
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.raw?.()['set-cookie'];
  const cookies = (setCookie || []).map((c) => c.split(';')[0]).join('; ');
  if (!cookies) throw new Error('no cookies from login');
  return cookies;
}

const COLLECTIONS = ['attendance', 'holidays', 'leave_requests', 'leave_balances', 'time_entries', 'active_timers'];

async function main() {
  const cookie = await login();
  console.log('logged in, cookie length', cookie.length);

  const ws = new WebSocket(WS_URL, { headers: { cookie } });
  const received = new Map();

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('WS connected');

  ws.send(JSON.stringify({ action: 'subscribe', channels: COLLECTIONS }));
  ws.on('message', (raw) => {
    try {
      const frame = JSON.parse(raw.toString());
      const collection = frame.event?.split('.')[0];
      if (COLLECTIONS.includes(collection)) {
        received.set(collection, (received.get(collection) || 0) + 1);
        console.log('FRAME', frame.event, JSON.stringify(frame.payload).slice(0, 120));
      }
    } catch {
      /* ignore */
    }
  });

  // Give the subscribe a moment to register, then trigger writes via the API.
  await new Promise((r) => setTimeout(r, 500));

  // 1) Attendance check-in (creates Attendance)
  await fetch(`${API}/attendance/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
  }).then((r) => r.json()).then((j) => console.log('check-in ->', JSON.stringify(j).slice(0, 150)));

  // 2) Holiday create
  await fetch(`${API}/holidays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'RC Test Holiday 2', date: '2026-11-25' }),
  }).then((r) => r.json()).then((j) => console.log('holiday ->', JSON.stringify(j).slice(0, 150)));

  // 3) Leave request create
  await fetch(`${API}/leave_requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, type: 'CASUAL', startDate: '2026-08-01', endDate: '2026-08-01', reason: 'rc test 2', daysCount: 1 }),
  }).then((r) => r.json()).then((j) => console.log('leave_request ->', JSON.stringify(j).slice(0, 150)));

  // 4) Leave balance create
  await fetch(`${API}/leave_balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, userId: '9np8nL0eHEQGY4PrlROE', year: 2026, paidLeave: 10 }),
  }).then((r) => r.json()).then((j) => console.log('leave_balance ->', JSON.stringify(j).slice(0, 150)));

  // wait for frames to arrive
  await new Promise((r) => setTimeout(r, 2000));

  console.log('--- RESULT ---');
  for (const c of COLLECTIONS) {
    console.log(c, received.has(c) ? `BROADCAST OK (${received.get(c)} frame(s))` : 'NO FRAME RECEIVED');
  }
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});

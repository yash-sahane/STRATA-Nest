// k6 load test for the STRATA API.
// Run (requires a running, seeded API):
//   BASE_URL=http://localhost:8000/api/v1 k6 run --stage 30s:100,2m:100,30s:0 infra/loadtest/k6-smoke.js
// Ramp profiles for 100/500/1000/5000 VUs are documented in LOAD_TEST_PLAN.md.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8000/api/v1';
const EMAIL = __ENV.LOGIN_EMAIL || 'loadtest@example.test';
const PASSWORD = __ENV.LOGIN_PASSWORD || 'LoadTest-Pass!1';

const loginTrend = new Trend('login_ms', true);
const listTrend = new Trend('list_ms', true);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Number(__ENV.VUS || 100) },
        { duration: '2m', target: Number(__ENV.VUS || 100) },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<500'], // P95 < 500ms target
  },
};

export default function () {
  // 1) login → cookie jar
  const jar = http.cookieJar();
  const login = http.post(`${BASE}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  loginTrend.add(login.timings.duration);
  check(login, { 'login 200': (r) => r.status === 200 });

  // 2) authenticated reads (cookies auto-sent from jar)
  const me = http.get(`${BASE}/auth/me`);
  check(me, { 'me 200': (r) => r.status === 200 });

  const list = http.get(`${BASE}/tasks?page=1&pageSize=25`);
  listTrend.add(list.timings.duration);
  check(list, { 'tasks 200': (r) => r.status === 200 });

  sleep(1);
  void jar;
}

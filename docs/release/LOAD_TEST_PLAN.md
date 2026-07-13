# Load Test Plan

**Tooling:** k6 (script committed at `infra/loadtest/k6-smoke.js`).
**Status of execution: NOT EXECUTED** (no running API/DB/Redis here).

## Environment (prereqs)
- API + worker + Postgres (seeded) + Redis running (docker-compose or staging).
- A seeded load-test user + a workspace/project with representative row counts (≥10k tasks) so list/filter reflect production.
- Metrics collection on (Prometheus/host stats) to capture CPU/memory alongside latency.

## Scenarios & ramps
Run the committed script at four concurrency levels (set `VUS`):

| Level | VUs | Ramp (stages) | Purpose |
|---|---|---|---|
| Smoke | 100 | 30s↑ / 2m hold / 30s↓ | baseline, correctness under mild load |
| Normal | 500 | 1m↑ / 5m hold / 1m↓ | expected peak |
| Stress | 1000 | 2m↑ / 5m hold / 2m↓ | headroom |
| Spike/soak | 5000 | 1m↑ / 10m hold / 2m↓ | saturation + memory-leak detection |

```
BASE_URL=https://staging/api/v1 VUS=500 k6 run infra/loadtest/k6-smoke.js
```

## Workload mix (extend the script before stress runs)
Weighted: 60% reads (list/retrieve across workspaces/projects/tasks), 20% auth
(login/refresh/me), 15% writes (task create/update, comments), 5% heavy
(`bulk-save` with a large tree, file upload/download). Add a WS client scenario
to measure realtime fan-out under connection churn.

## Metrics & thresholds (gates)
- `http_req_failed` < 1%; `http_req_duration` P95 < 500ms (retune to the **measured baseline** once established — the real gate is "no regression vs. that baseline").
- Per-endpoint P50/P95/P99, throughput; host CPU < 80%, no unbounded RSS growth over the soak (leak check); DB connections within pool; Redis latency stable.
- Queue: under write load, email/git jobs drain without backlog growth (see CHAOS_TEST_PLAN for backlog behavior).

## Exit criteria
All four levels meet thresholds AND show no P95 regression vs. the established baseline, with flat
memory over the 10m soak. Record the measured numbers when the run completes.

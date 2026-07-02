# Auth Benchmark — Django vs NestJS

> **Goal (per review):** not to prove Nest is *faster*, but to ensure **nothing became ~5× slower**. Authentication is on the hot path of every request.
>
> **Status:** ⏳ **PENDING LIVE RUN** — the harness is ready; numbers are filled by running it against both backends on comparable hardware/DB. No numbers are fabricated.

## Methodology
- Script: [`scripts/verify/auth-benchmark.mjs`](../scripts/verify/auth-benchmark.mjs) (Node global `fetch`).
- `N` samples per endpoint (default 30; use ≥50 for stable p95), one warm-up login discarded.
- Endpoints: `login`, `me`, `profile (PATCH)`, `refresh` (each `refresh` iteration does an untimed fresh login to get a rotatable cookie).
- Report **avg / p50 / p95 ms**. Run Django and Nest against the **same Postgres** for a fair comparison.

## How to run
```bash
# Django
BASE=http://localhost:8000 EMAIL=u@x.test PASSWORD=pw N=50 node scripts/verify/auth-benchmark.mjs "Django"
# Nest
BASE=http://localhost:8001 EMAIL=u@x.test PASSWORD=pw N=50 node scripts/verify/auth-benchmark.mjs "NestJS"
```

## Results (fill in)

### Django  (N=…, http://localhost:8000)
| Endpoint | avg ms | p50 ms | p95 ms |
|---|---|---|---|
| login | ⏳ | ⏳ | ⏳ |
| me | ⏳ | ⏳ | ⏳ |
| profile (PATCH) | ⏳ | ⏳ | ⏳ |
| refresh | ⏳ | ⏳ | ⏳ |

### NestJS  (N=…, http://localhost:8001)
| Endpoint | avg ms | p50 ms | p95 ms |
|---|---|---|---|
| login | ⏳ | ⏳ | ⏳ |
| me | ⏳ | ⏳ | ⏳ |
| profile (PATCH) | ⏳ | ⏳ | ⏳ |
| refresh | ⏳ | ⏳ | ⏳ |

### Ratio gate
| Endpoint | Nest / Django | Pass (< 2×)? |
|---|---|---|
| login | ⏳ | ⏳ |
| me | ⏳ | ⏳ |
| profile | ⏳ | ⏳ |
| refresh | ⏳ | ⏳ |

## Expected shape of the numbers (analysis, to confirm)
- **`login` is dominated by PBKDF2**, not the framework. Django verifies at 870k iterations; Nest at 600k. Both are tens of milliseconds of pure CPU — so login latency should be **comparable** and CPU-bound on both. If Nest's login is wildly higher, suspect double-hashing or an accidental sync stall, not Nest itself.
- **`me` / `profile`** are DB-bound (1–2 queries) + JWT verify (sub-ms). Expect Nest ≈ Django or faster.
- **`refresh`** is JWT verify + one Redis round-trip (the D1 revocation). The Redis op adds ~sub-ms locally; ensure it isn't on a slow/remote Redis in prod.
- **Gate:** flag any endpoint where Nest p95 > **2×** Django p95 for investigation; **hard-fail** at 5×.

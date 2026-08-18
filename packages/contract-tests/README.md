# @lt/contract-tests

The **parity net** for the strangler migration (ADR-0003, ADR-0010; arch §19).

The same suite runs against **either** backend, selected by env:

| Env | Meaning |
|---|---|
| `DJANGO_API_URL` | default target — the legacy API we lock the contract from |
| `CONTRACT_BASE_URL` | explicit override — point at NestJS to prove parity |
| `CONTRACT_COOKIE` | optional `lt_access=<jwt>` to exercise authenticated contracts |

## Usage

```bash
# 1. Lock the contract against the running Django API
DJANGO_API_URL=http://localhost:8000 pnpm --filter @lt/contract-tests test

# 2. Later, per module ported, prove NestJS matches
CONTRACT_BASE_URL=http://localhost:8000 pnpm --filter @lt/contract-tests test
```

If the target is unreachable, envelope checks become no-ops with a warning (so
CI won't fail when no API is up) — start the target to enforce them.

## What it locks today
- **Error envelope** `{ error: { message, code, type } }` (A§4.5).
- **Pagination envelope** `{ items, total, page, pageSize }` (A§4.4, opt-in via cookie).

## Growing the net
Each migration phase (M§9) adds `*.contract.spec.ts` files for the module it
ports (field names, status codes, filter operators, WS frames). Characterization
snapshots of real Django responses can be recorded here and asserted against
NestSQL output before flipping nginx routing.

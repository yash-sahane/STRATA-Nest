# @strata/contract-tests

Wire-contract regression suite.

Point it at the running API:

| Env | Meaning |
|---|---|
| `CONTRACT_BASE_URL` | the running NestJS API to test against |
| `CONTRACT_COOKIE` | optional `strata_access=<jwt>` to exercise authenticated contracts |

## Usage

```bash
CONTRACT_BASE_URL=http://localhost:8000 pnpm --filter @strata/contract-tests test
```

If the target is unreachable, envelope checks become no-ops with a warning (so
CI won't fail when no API is up) — start the API to enforce them.

## What it locks today
- **Error envelope** `{ error: { message, code, type } }`.
- **Pagination envelope** `{ items, total, page, pageSize }` (opt-in via cookie).

## Growing the net
Add `*.contract.spec.ts` files per module (field names, status codes, filter
operators, WS frames) to keep the frozen wire contract under regression cover.

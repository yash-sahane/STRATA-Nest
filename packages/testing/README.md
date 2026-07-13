# @strata/testing

Shared **test infrastructure** so no module reinvents test utilities (per architecture review).

| Area | Contents | Grows into |
|---|---|---|
| `test-utils/` | `randomEmail`, `uniqueSuffix`, `wait` | HTTP/e2e helpers |
| `factories/` | `defineFactory` (generic) | `userFactory`, `taskFactory`, … (per module) |
| `builders/` | `Builder<T>` base | `TaskBuilder`, `SprintBuilder`, … |
| `fixtures/` | — | captured payloads for regression diffing |
| `auth/` | cookie names, `authCookieHeader`, `parseSetCookies` | `mintTestToken` |
| `workspace/` | — | `seedWorkspace`, `addMember`, `withRole` |

Also re-exports `generateId`/`isNativeId` from `@strata/common` so test entities use contract-consistent 20-char IDs (ADR-0002).

**Consumption:** source package (`main`/`types` → `src`), imported by `*.spec.ts` via `@strata/testing`. Domain helpers are added alongside the module that introduces the domain type.

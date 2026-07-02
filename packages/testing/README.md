# @lt/testing

Shared **test infrastructure** so no module reinvents test utilities (per architecture review).

| Area | Phase 0 (now) | Grows into |
|---|---|---|
| `test-utils/` | `randomEmail`, `uniqueSuffix`, `wait` | HTTP/e2e helpers |
| `factories/` | `defineFactory` (generic) | `userFactory`, `taskFactory`, … (per module) |
| `builders/` | `Builder<T>` base | `TaskBuilder`, `SprintBuilder`, … |
| `fixtures/` | — | captured Django payloads for characterization diffing |
| `auth/` | cookie names, `authCookieHeader`, `parseSetCookies` | `mintTestToken` (after AuthModule) |
| `workspace/` | — | `seedWorkspace`, `addMember`, `withRole` (after WorkspacesModule) |

Also re-exports `generateId`/`isNativeId` from `@lt/common` so test entities use contract-consistent 20-char IDs (ADR-0002).

**Consumption:** source package (`main`/`types` → `src`), imported by `*.spec.ts` via `@lt/testing`. Domain helpers are added alongside the module that introduces the domain type — Phase 0 ships only domain-agnostic primitives.

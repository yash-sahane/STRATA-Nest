# STRATA — UI/UX Remediation Plan

Companion to [UI_CONSISTENCY_REPORT.md](UI_CONSISTENCY_REPORT.md). Sequenced to fix **root causes before symptoms** and **highest blast radius first**, so each wave unblocks the next and the app never regresses. Issue IDs (e.g. `TOAST-01`) reference the report.

## Guiding principles

1. **Fix at the highest safe altitude.** Token → primitive → shared component → shell → domain → page. Never patch N pages when one primitive is the cause.
2. **Reuse existing shadcn primitives.** No competing design system, no gratuitous gradients/shadows/radius changes.
3. **Preserve business logic & API behavior.** UI-only unless a UX fix genuinely requires data changes (flagged: `FORM-05`).
4. **Incremental & reviewable.** One wave = one reviewable PR (or a small stack). After each structural fix, grep the whole frontend for the same pattern before calling it done.
5. **Verify, don't assume.** Each wave has a validation gate (typecheck, lint, targeted Playwright, light+dark, keyboard, console/network, overflow). No wave proceeds over a regression.

## Dependency overview

```
Wave 1 (tokens, toast, motion)  ──┬──> Wave 2 (primitives: Badge, Button, Input, Dialog, Skeleton, Sheet, semantic-color modules)
                                  │        │
                                  │        └──> Wave 3 (shell: PageContainer, PageHeader adoption, sidebar/nav, error/not-found)
                                  │                 │
                                  └──> Wave 4 (shared UX: loading/empty/error, forms, confirm, toolbar/filters) 
                                                    │
        Wave 5 (high-traffic pages) ──> Wave 6 (boards, analytics, AI, attendance/leave) ──> Wave 7 (responsive+a11y) ──> Wave 8 (polish)
```

Waves 1–2 are **foundational and small** (~8 files) and de-risk ~30 issues. Waves 3–4 are structural. Waves 5–6 migrate domains onto the new foundation. Waves 7–8 harden and polish.

---

## Wave 1 — Foundations (tokens · toast · motion)

**Goal:** give color, feedback, and motion a single source of truth. Nothing visual should regress; this mostly *adds* capability.

| Issue | Change | Files |
|---|---|---|
| `DS-01` | Add `--success/--warning/--info` (+ `-foreground`) for light & dark; expose via `@theme inline`. | `styles/globals.css` |
| `A11Y-01` | Add `@media (prefers-reduced-motion: reduce)` global neutralizer; keep `.no-animations` as manual override. | `styles/globals.css` |
| `ANIM-01` | Add motion duration tokens + document scale. | `styles/globals.css`, `DESIGN_SYSTEM.md` |
| `TOAST-01` (P0) | Standardize on **sonner**. Rewrite `hooks/use-toast.ts` to re-export a sonner-shaped `toast()` mapping `{title,description,variant:'destructive'}` → `toast.error/success`. Immediately fixes all 15 dead call sites without touching them. | `hooks/use-toast.ts` |
| `DS-05` | Fix/remove stale `tailwind.config.ts` reference. | `components.json` |

**Dependencies:** none (do first).
**Expected impact:** Restores success/error feedback across **9 data hooks + 6 components** (projects, sprints, epics, leave, attendance, notifications, requirements, workspaces, AI, onboarding). Establishes the color/motion vocabulary every later wave consumes.
**Regression risks:** (a) Double toasts where a component *and* its hook both toast — grep for components that call sonner directly *and* a hook that now toasts; (b) reduced-motion CSS too aggressive — scope to `transition`/`animation`, exclude essential `Loader2` spin.
**Validation:** typecheck; manually trigger one create + one delete in projects, sprints, leave, notifications (see toasts now); toggle OS reduced-motion and confirm page-header/dialog animations stop but spinners still spin; verify no duplicate toasts on tasks/profile/settings (already sonner).

**Verification-first note:** Before deleting the Radix `components/ui/toast.tsx`, confirm zero remaining imports of the *primitive* (not the hook). Delete in Wave 8.

---

## Wave 2 — UI primitives & semantic-color modules

**Goal:** make the shared building blocks correct so pages inherit consistency.

| Issue | Change | Files |
|---|---|---|
| `DS-02`, `A11Y-02` | Rewire `Badge` `success/warning/info` to tokens with accessible foregrounds (dark text on warning). | `components/ui/badge.tsx` |
| `SIZE-01` | Unify control heights (recommend Button `h-9` ↔ Input/Select `h-9`, or all `h-10` — pick one; document). | `button.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx` |
| `DIALOG-01` | Add `sm:justify-end` to `DialogFooter`. | `components/ui/dialog.tsx` |
| `SIZE-02` | Add `size` prop to `DialogContent` (`sm/md/lg/xl`). | `dialog.tsx` |
| `FORM-03` | Add `loading` prop to `Button` (spinner + auto-`disabled`). | `button.tsx` |
| `TYPO-02` | Reduce default `CardTitle` to `text-base`/`text-lg`; add opt-in large. | `components/ui/card.tsx` |
| `LOAD-01` | Add `Skeleton` primitive. | `components/ui/skeleton.tsx` (new) |
| `DIALOG-02` | Add `Sheet` primitive. | `components/ui/sheet.tsx` (new) |
| `COLOR-01…09` | Create `lib/semantic/` — `priority.ts`, `status.ts` (task/epic/FR/project/requirement), `health.ts`, `attendance.ts`, `entity.ts`, `labels.ts`, `chart.ts`. One map each, token-based, with icon+label. | `lib/semantic/*` (new) |
| `DS-03` | `chart.ts` reads `hsl(var(--chart-n))`; single Recharts theme helper. | `lib/semantic/chart.ts` |

**Dependencies:** Wave 1 (tokens).
**Expected impact:** Every downstream page/board/table that adopts these gets consistent color, sizing, footers, loading, and dialog widths for free. Centralizes 6 priority + 4 FR + 2 project + 2 requirement + 2 attendance + 2 health maps into one place each.
**Regression risks:** `CardTitle` and control-height changes are global — **visual-test all cards and toolbars**. `SIZE-01` may shift toolbar layouts. Semantic modules don't change anything until consumed (safe to land early).
**Validation:** typecheck; Storybook-less spot check — render Badge all variants light+dark (contrast); screenshot a toolbar (input+button aligned); open 3 dialogs (footer right-aligned, widths sane); Skeleton renders.

---

## Wave 3 — Application shell

**Goal:** every page gets an identical structural foundation.

| Issue | Change | Files |
|---|---|---|
| `LAYOUT-02/03`, `RESP-01` | Introduce `PageContainer` (max-width + `mx-auto` + standard padding) OR add to `<main>`; remove per-page `container`/`p-8`/`max-w-7xl`. | `components/layout/page-container.tsx` (new), `(dashboard)/layout.tsx` |
| `LAYOUT-01`, `TYPO-01` | Adopt `PageHeader` on all 26 hand-rolled pages (bake the title decision into the primitive). | all `app/(dashboard)/**/page.tsx` |
| `NAV-01` | Render visual sidebar groups; add missing destinations (Leave, Workspaces, analytics sub-routes) or intentionally nest them. | `components/layout/sidebar.tsx` |
| `NAV-03` | Fix imperative width mutation → state/context; remove flash-of-expanded; drop nested `TooltipProvider`; use `Avatar` primitive. | `sidebar.tsx`, `(dashboard)/layout.tsx` |
| `ERROR-02` | Add `app/global-error.tsx`, `app/(dashboard)/error.tsx`, `app/not-found.tsx`. | new files |
| `LOAD-02`, `FLOW-01` | Collapse triple loaders into one; consider middleware auth redirect. | `(dashboard)/layout.tsx`, `workspace-guard.tsx`, `middleware.ts` |

**Dependencies:** Wave 2 (`PageHeader` title decision, `Avatar`, error/empty components from Wave 4 can land in parallel; use placeholders if needed).
**Expected impact:** Uniform width, padding, title, and top-of-page across all routes; missing features become discoverable; branded error/404; single cold-start loader.
**Regression risks:** `PageContainer` shifts every page's width — **full visual-regression pass**. Sidebar refactor touches navigation — test active states and collapse persistence. Middleware redirect must not loop.
**Validation:** screenshot every route before/after at 1440px + 375px; click every nav item (active state, no missing routes); force a thrown error and a bad URL (styled boundaries); cold-load shows one loader.

---

## Wave 4 — Shared UX patterns

**Goal:** one contract for loading, empty, error, confirm, forms, toolbars.

| Issue | Change | Files |
|---|---|---|
| `LOAD-01/03/04` | Page-state helper/contract (skeleton for initial structured load, `InlineLoader` for sections, `Button loading` for actions, keep-content on refetch); replace bespoke spinners. | `components/ui/*`, pages |
| `EMPTY-01/02/03` | Route all empties through `EmptyState`; add `NoWorkspace` state + first-use vs no-results modes. | `empty-state.tsx`, pages |
| `ERROR-01` | `ErrorState` component + adopt in page-state contract (consume `isError`). | `components/ui/error-state.tsx` (new), pages |
| `DESTRUCT-01` (P0), `DESTRUCT-02/03` | `useConfirm()` / `<ConfirmDialog>`; require confirm for every destructive action (esp. **Clear All Notifications**); replace `window.confirm`; destructive `AlertDialogAction` variant. | `hooks/use-confirm.ts` (new), `alert-dialog.tsx`, domains |
| `LAYOUT-04`, `SIZE-03` | `PageToolbar` + `SearchInput` + `FilterBar`; standard filter widths. | `components/layout/*` (new) |
| `FORM-01/02/03/04` | Standardize create/edit dialogs on RHF+zod + `Form` primitives + `Button loading`; shared zod schemas. | `components/**/*-dialog.tsx` |

**Dependencies:** Waves 2–3.
**Expected impact:** Loading/empty/error/confirm/forms behave identically everywhere; **no more silent destructive actions**; double-submit closed.
**Regression risks:** Form migration is broad — migrate one entity at a time, test create+edit+validation for each. Confirm-dialog wrapping must not block legitimate fast paths.
**Validation:** per entity — submit valid/invalid, double-click submit (blocked), cancel mid-pending; trigger a query error (ErrorState + retry); every delete asks first; filter to empty (no-results state, not first-use CTA).

---

## Wave 5 — High-traffic workflows

**Goal:** migrate the most-used surfaces onto the new foundation.

**Surfaces:** auth (`login`, `change-password`), `onboarding`, `dashboard`, `projects` (+ detail/settings), `tasks`, `sprints` (+ backlog).
**Issues:** consume `PageContainer`/`PageHeader`/page-state/toolbar; apply semantic-color modules (`COLOR-01/02/07`); fix `change-password` triple-spinner (`LOAD-01`); `sprints` `window.confirm` → confirm dialog (`DESTRUCT-01`); dashboard status variants (`COLOR-07`).
**Dependencies:** Waves 1–4.
**Expected impact:** The pages users see most become the consistency reference.
**Regression risks:** high-traffic — screenshot-diff each; verify realtime task updates still work.
**Validation:** full flow tests — login→dashboard, create project→open, create task→move on board, create sprint→backlog→board.

---

## Wave 6 — Complex interfaces

**Goal:** unify the hard, duplicated surfaces.

| Issue | Change |
|---|---|
| `BOARD-01`, `COLOR-02`, `INTERACT-01` | Extract configurable `<Board>`; drive columns/colors from `lib/semantic/status.ts`; unify drag feedback & mutation pattern; keep task/FR data differences as props. |
| `NAV-04` | Resolve analytics IA (deep-link tabs or canonical sub-pages; add redirects; delete the redundant one). |
| `DS-03` | Charts consume `chart.ts` (one palette). |
| `FLOW-02` | AI flow: real feedback (TOAST-01) + step status UI + disabled submit. |
| `COLOR-05/08`, `DARK-01` | Migrate attendance/leave/team/health onto tokens + semantic modules (highest raw-palette density). |
| `TABLE-01/02/03` | FR table → `Table`; introduce `DataTable`/`Pagination`; unify empty/row-click. |

**Dependencies:** Waves 2–5.
**Expected impact:** Boards, analytics, charts, AI, and data-dense HR screens become consistent; the 912 raw-palette count drops sharply.
**Regression risks:** Board and table refactors are core — extensive drag/drop, realtime, and pagination tests. Analytics route changes need redirects to avoid broken links/bookmarks.
**Validation:** drag across all columns on both boards; verify sprint FR translation; page through a large table; charts legible light+dark; AI generate→review→save with visible status.

---

## Wave 7 — Responsive & accessibility

**Goal:** app-wide hardening.
**Issues:** `RESP-01` (verify 320/375/430/768/1024/1280/1440/1920 — nav, headers, forms, dialogs, boards, tables, charts, filters, command palette); `A11Y-02` (contrast pass on migrated status colors); `A11Y-03` (icon-only labels, focus order, focus-visible survives color changes); `NAV-05` (mobile nav → `Sheet`); `DARK-01` (dark pass now that tokens carry dark values).
**Dependencies:** Waves 1–6.
**Expected impact:** Usable and accessible across breakpoints and themes; no horizontal overflow; keyboard-complete.
**Regression risks:** breakpoint tweaks can shift desktop — re-diff desktop after mobile fixes.
**Validation:** Playwright at each viewport (screenshots + no `document.scrollingElement.scrollWidth > clientWidth`); axe/keyboard sweep of dialogs, menus, forms, boards; dark-mode screenshot pass.

---

## Wave 8 — Final polish

**Goal:** motion, micro-interactions, cleanup.
**Issues:** `ANIM-01`/`INTERACT-01` (apply motion tokens; standardize hover/lift); `NAV-02` (unify header search into command palette); `TYPO-03`/`SIZE-04` (off-scale sizes, card density); remove dead code (`task-board` unused `color` field, duplicated `labelColorMap`, Radix `toast.tsx` once unimported); `DS-04` (density system on tokens).
**Dependencies:** all prior.
**Validation:** final cross-page comparison per Phase 31; re-mark every report issue FIXED/PARTIAL/DEFERRED.

---

## Cross-wave validation gate (run after every wave)

1. `pnpm --filter @strata/frontend typecheck`
2. `pnpm --filter @strata/frontend lint`
3. Existing Playwright (`apps/frontend/e2e`) + any wave-specific specs
4. Manual/automated flow test for the wave's surfaces
5. Responsive spot-check (≥ 375px + 1440px)
6. Light **and** dark mode
7. Keyboard navigation of changed interactive elements
8. Browser console (no new errors) + network (no new failed requests)
9. Layout overflow check
10. **Stop and fix on any regression before continuing.**

## Effort & sequencing summary

| Wave | Theme | Rough effort | Issues resolved/advanced |
|---|---|---|---|
| 1 | Tokens · toast · motion | S–M | DS-01, DS-05, ANIM-01, A11Y-01, **TOAST-01** |
| 2 | Primitives · semantic modules | M–L | DS-02/03, SIZE-01/02, DIALOG-01/02, FORM-03, TYPO-02, LOAD-01, COLOR-01…09, A11Y-02 |
| 3 | Shell | M–L | LAYOUT-01/02/03/05, TYPO-01, NAV-01/03, ERROR-02, LOAD-02, FLOW-01 |
| 4 | Shared UX | L | LOAD-01/03/04, EMPTY-01/02/03, ERROR-01, **DESTRUCT-01**/02/03, LAYOUT-04, FORM-01/02/03/04 |
| 5 | High-traffic pages | M–L | migrations + COLOR-07, LOAD-01, DESTRUCT-01 |
| 6 | Complex interfaces | L | BOARD-01, NAV-04, DS-03, FLOW-02, COLOR-05/08, TABLE-01/02/03, DARK-01, INTERACT-01 |
| 7 | Responsive · a11y | M–L | RESP-01, A11Y-02/03, NAV-05, DARK-01 |
| 8 | Polish | M | ANIM-01, NAV-02, TYPO-03, SIZE-04, DS-04, dead-code removal |

**Do-first, highest-leverage set (≈8 files):** `globals.css` (DS-01/A11Y-01/ANIM-01), `hooks/use-toast.ts` (TOAST-01), `badge.tsx`, `button.tsx`, `input.tsx`/`select.tsx`, `dialog.tsx`, `card.tsx`, `lib/semantic/*`. Landing Waves 1–2 alone resolves or de-risks ~30 of 55 issues before any page is redesigned.

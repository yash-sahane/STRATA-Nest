# Phase 10 — Files + Email Queue

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Redis+worker environment.**
Done: `FilesModule` (multipart upload + CRUD + preview/view/download streaming) behind **StorageService** (arch §13) — local driver fully implemented with a path-traversal guard; blob key layout + `url` kept byte-identical to Django. `EmailModule` **producer** enqueues to the BullMQ `email` queue; `MailService` (reset/welcome/invitation) and the ported `email/send-*` HTTP endpoints now enqueue instead of sending inline (D7). `apps/worker` runs the **email processor** (Resend when keyed, else logs) with retries/backoff + `idempotencyKey→jobId` dedupe. Typecheck + DI graph green for **both api and worker**; **78 api + 2 worker unit tests**.
**Deferred/deviations (documented):** S3 driver is lazy-loaded and throws if selected without `@aws-sdk/client-s3` (local is the built driver); `email/send-*` responses are now **optimistic** (`{success, backend, sent, queued}`) rather than the synchronous transport outcome; files are auth+membership-scoped only (`FileRead/FileWrite` reserved for later RBAC); a true inline SMTP fallback is represented by `EMAIL_TRANSPORT=inline` (logs) — Resend/Django-mail send runs in the worker.
Pending: live streaming-header/`url` reconciliation, enqueue→processed integration test against real Redis, S3 driver + `@aws-sdk` install.

## Goal
Port file uploads/streaming behind a `StorageService`, and move email from synchronous inline sends to the BullMQ **email queue** (A§6.13–6.14, D7).

## Scope
- `FilesModule`: `files` CRUD (multipart), `preview`/`view`/`download` streaming; `StorageService` (local/S3 drivers, arch §13).
- `EmailModule` producer → `email` BullMQ queue; `apps/worker` email processor (Resend + Django-mail fallback).
- Wire the invitation/welcome/reset/notification emails (from Phases 1/2/9) through the queue.

## Out of Scope
- Reminder/deadline/attendance scheduled jobs (can follow as repeatable jobs; not blocking).
- Push notifications.

## Deliverables
- `UploadedFile` model (promote `workspaceId`/`projectId`, `""`→null); Multer + `StorageService`.
- Email queue + processor with retries/backoff/idempotency (ADR-0007).
- Char + contract tests for file endpoints; queue integration tests (enqueue → processed).

## Acceptance Criteria
- [ ] File CRUD + streaming byte-identical (headers, disposition, `url`).
- [ ] Uploads land in the configured store (local in dev, S3 in prod) via `StorageService` — modules never call an SDK directly.
- [ ] Emails are enqueued (not sent inline); a failed send retries and is observable.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flag for `files`. Email: a synchronous fallback path is retained; the queue can be bypassed by a flag to send inline (matching Django) if the worker is unavailable. Storage driver is config-switchable.

## Risks
- **Blob path/URL differences** between Django storage and `StorageService` → contract tests assert `url` + stream headers; keep the same `uploads/{ws}/{id}/{name}` key layout.
- **Queue outage** → inline fallback flag prevents dropped mail during cutover.

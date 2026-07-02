# Phase 10 — Files + Email Queue

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

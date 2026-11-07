# ADR-0007 — BullMQ async + commit-then-emit (no side effects inside transactions)

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
Without a dedicated async layer, transactional email would run **synchronously inline** via a blocking Resend HTTP call in the request path, and realtime fan-out would run inline and pre-commit. Heavy and retryable work must not run in the request path.

## Decision
Adopt **BullMQ** (Redis) with isolated queues (email, notification, reminder, deadline, attendance, ai, git, webhook, export, import) consumed by `apps/worker`. Establish a **hard side-effect ordering rule**: never enqueue a job, emit a WS frame, or send email **inside** a DB transaction. The sequence is always `transaction → commit → emit domain event → subscriber performs the side effect`. Jobs are idempotent via deterministic `jobId`s; retries use exponential backoff.

## Consequences
- (+) Removes blocking I/O from the request path; reliable retries/observability for email and integrations.
- (+) No phantom side effects on rollback.
- (−) New infra (worker, Bull Board, metrics) to operate — accepted; Redis is already present.
- Follow-up: Redis partitioned by logical DB — DB0 cache, sessions and realtime fan-out (pub/sub is not per-database), DB1 BullMQ. No socket database was needed.

## Alternatives considered
- **In-process async (no worker):** rejected — couples heavy/retryable work to API uptime and latency.


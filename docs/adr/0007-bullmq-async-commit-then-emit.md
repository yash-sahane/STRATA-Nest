# ADR-0007 — BullMQ async + commit-then-emit (no side effects inside transactions)

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
Celery is configured but has **zero tasks** (A§8); the only "async" work — email — runs **synchronously inline** via a blocking Resend HTTP call in the request path (A§6.14, D7). Realtime fan-out also runs inline and pre-commit (A§7.2, D10). The async layer is effectively greenfield.

## Decision
Adopt **BullMQ** (Redis) with isolated queues (email, notification, reminder, deadline, attendance, ai, git, webhook, export, import) consumed by `apps/worker`. Establish a **hard side-effect ordering rule**: never enqueue a job, emit a WS frame, or send email **inside** a DB transaction. The sequence is always `transaction → commit → emit domain event → subscriber performs the side effect`. Jobs are idempotent via deterministic `jobId`s; retries use exponential backoff.

## Consequences
- (+) Removes blocking I/O from the request path; reliable retries/observability for email and integrations.
- (+) No phantom side effects on rollback (fixes D7, D10).
- (−) New infra (worker, Bull Board, metrics) to operate — accepted; Redis is already present (A§3).
- Follow-up: Redis partitioned by logical DB (DB0 cache, DB1 BullMQ, DB2 socket adapter).

## Alternatives considered
- **Port Celery 1:1:** N/A — nothing to port (A§8).
- **In-process async (no worker):** rejected — couples heavy/retryable work to API uptime and latency.

## Traceability
A§3, A§6.14, A§7.2, A§8, D7, D10 · §4, §10, §11, M§6.2

# @lt/prisma

Database access for the NestJS stack. Split-folder schema under `schema/` (arch §5).

## Phase 0 stance
`schema/base.prisma` declares **only** the datasource + generator. Domain models are **not** hand-written here. Per ADR-0010 (strangler migration), the existing Django Postgres is the source of truth, so models are **introspected**:

```bash
# 1. Point DATABASE_URL at the existing DB (.env)
pnpm prisma:pull        # prisma db pull  -> writes models into schema/
pnpm prisma:generate    # prisma generate -> emits the typed client
```

Until `generate` runs, `@prisma/client` has no model types — expected for a fresh checkout.

## Later phases
Per-module, introspected models are refined: soft FKs → nullable relations + backfill (ADR-0008), JSON arrays → join/edge tables (`TaskLabel`, `TaskDependency`), normalized permissions, append-only `ActivityLog`, etc. Each change ships with a `prisma migrate` step (arch §20). **Identity stays a 20-char string PK** (ADR-0002) — never regenerate IDs.

## Exports
- `PrismaService` — injectable client with lifecycle + `ping()`.
- `PrismaModule` — global module.

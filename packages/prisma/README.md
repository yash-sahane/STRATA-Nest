# @strata/prisma

Database access for STRATA. Split-folder schema under `schema/`.

## Schema ownership
This package owns the database schema. Domain models live under `schema/` and
are versioned through `packages/prisma/migrations/`; run `prisma migrate deploy`
to apply them.

```bash
pnpm --filter @strata/prisma run generate   # prisma generate -> emits the typed client
```

Until `generate` runs, `@prisma/client` has no model types — expected for a fresh checkout.

## Evolving the schema
Soft FKs → nullable relations + backfill (ADR-0008), JSON arrays → join/edge tables (`TaskLabel`, `TaskDependency`), normalized permissions, append-only `ActivityLog`, etc. Each change ships with a `prisma migrate` step. **Identity is a 20-char string PK** — never regenerate IDs.

## Exports
- `PrismaService` — injectable client with lifecycle + `ping()`.
- `PrismaModule` — global module.

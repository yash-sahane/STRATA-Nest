-- Retention archive (delete-semantics sprint). Additive; snapshots HR/audit rows
-- before an aggregate-root delete removes the live rows (ArchiveService).

-- CreateTable
CREATE TABLE "retention_archive" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retention_archive_entity_type_entity_id_idx" ON "retention_archive"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "retention_archive_workspace_id_idx" ON "retention_archive"("workspace_id");

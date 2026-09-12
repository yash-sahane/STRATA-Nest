-- FunctionalRequirement: add the `type` and `parent_requirement_id` columns the
-- client already sends (previously whitelist-stripped), enabling FR type
-- classification and parent/child FR hierarchies. Additive; defaults backfill
-- existing rows.

-- AlterTable
ALTER TABLE "requirements_functionalrequirement" ADD COLUMN     "parent_requirement_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'FUNCTIONAL';

-- CreateIndex
CREATE INDEX "requirements_functionalrequirement_parent_requirement_id_idx" ON "requirements_functionalrequirement"("parent_requirement_id");

-- NotificationPreference: per-user, per-workspace delivery toggles for one
-- notification `type`. Opt-out model — a missing row means "deliver on every
-- channel", so no backfill is required and existing behaviour is unchanged
-- until a user turns something off. The table is new, so its unique constraint
-- cannot collide with existing rows.

-- CreateTable
CREATE TABLE "notifications_notificationpreference" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notifications_notificationpreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_notificationpreference_user_id_idx" ON "notifications_notificationpreference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_notifpref_workspace_user_type_key" ON "notifications_notificationpreference"("workspace_id", "user_id", "type");

-- Whether a stored integration credential has ever been shown to work.
--
-- All three providers accepted an access token or webhook URL without ever
-- calling the provider: a garbage token and a nonexistent repository saved
-- successfully, were encrypted at rest, and then silently never worked. A broken
-- integration looked exactly like a working one.
--
-- Nullable on purpose. NULL means "never tested", which is a real state the UI
-- shows as such — defaulting last_test_ok to false would claim every existing
-- integration had been tested and failed, and defaulting to true would claim
-- they all work.
ALTER TABLE "integrations_githubintegration"
  ADD COLUMN IF NOT EXISTS "last_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_test_ok" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "last_test_error" TEXT;

ALTER TABLE "integrations_gitlabintegration"
  ADD COLUMN IF NOT EXISTS "last_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_test_ok" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "last_test_error" TEXT;

ALTER TABLE "integrations_discordintegration"
  ADD COLUMN IF NOT EXISTS "last_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_test_ok" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "last_test_error" TEXT;

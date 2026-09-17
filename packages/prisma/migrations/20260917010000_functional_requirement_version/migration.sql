-- The same version counter on functional requirements, closing the seam the first
-- migration left.
--
-- Five models got one because their edit dialogs submit a whole form, which is where the
-- worst version of the bug lived. A functional requirement's detail dialog is narrower —
-- it writes only `sprint_id`, `assigned_to` and `assigned_to_names` — so it was never
-- capable of overwriting a field nobody had touched. It IS capable of the other half:
-- two managers reassigning the same requirement, where the later save wins outright and
-- neither is told.
--
-- Leaving it out would also make a strange seam. A client requirement refuses that save
-- and the functional requirement hanging off it does not, on screens a person moves
-- between without thinking about which table they are on.
--
-- See the optimistic_locking_version migration for what this column is and why it is not
-- `updated_at`.

ALTER TABLE "requirements_functionalrequirement"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- A client requirement's statuses are the six every screen offers. PROPOSED was
-- a second word for SUBMITTED; ON_HOLD and REJECTED were accepted by the API and
-- offered nowhere, so a row holding one could not be shown or set back.
UPDATE "requirements_clientrequirement" SET "status" = 'SUBMITTED' WHERE "status" = 'PROPOSED';
UPDATE "requirements_clientrequirement" SET "status" = 'APPROVED' WHERE "status" = 'ON_HOLD';
UPDATE "requirements_clientrequirement" SET "status" = 'ARCHIVED' WHERE "status" = 'REJECTED';
UPDATE "requirements_clientrequirement" SET "status" = 'DRAFT'
  WHERE "status" NOT IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

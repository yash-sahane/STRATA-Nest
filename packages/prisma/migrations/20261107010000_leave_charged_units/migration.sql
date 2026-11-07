-- What approving a leave request actually took from the balance — or, for
-- unpaid leave, added to the days taken — kept on the request.
--
-- Every refund used to be worked out again from the request's day count:
-- cancelling refunded requiredUnits(type, days_count), ending early refunded the
-- difference between that and the days taken. That is only what was charged if
-- the two never part, and they do: when a holiday inside an approved leave is
-- removed, the leave grows by a day, but the extra day is charged only as far as
-- the balance still covers it — while days_count grows regardless. Cancelling it
-- afterwards refunded the larger count: a day given back that was never taken.
--
-- Refunds now give back what was charged, never more, and the holiday re-count
-- moves the charge towards what the leave now costs, recording what it really
-- moved.

ALTER TABLE "leave_leaverequest"
  ADD COLUMN "charged_units" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Requests approved before this were charged by the rule every refund used:
-- one unit for a half day, otherwise the day count rounded up.
UPDATE "leave_leaverequest"
SET "charged_units" = CASE
  WHEN "type" = 'HALF_DAY' THEN 1
  ELSE GREATEST(0, CEIL("days_count"))
END
WHERE "status" = 'APPROVED';

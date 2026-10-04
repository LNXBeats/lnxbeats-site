-- Support-only additive recovery state. No historical migration edited.
ALTER TABLE "support_contribution_attempts"
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "leaseUntil" TIMESTAMPTZ(3),
  ADD COLUMN "lastCheckedAt" TIMESTAMPTZ(3);
ALTER TABLE "support_contribution_events" ADD COLUMN "evidence" JSONB;
-- REQUESTED intentionally includes an unknown provider outcome: never replay
-- a POST merely because this row has no locally persisted result.
CREATE INDEX "support_attempt_recovery_idx"
  ON "support_contribution_attempts" ("status", "lastCheckedAt");

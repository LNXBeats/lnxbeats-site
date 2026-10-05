-- Optional fields preserve historical contributions as NULL. No backfill/send.
ALTER TABLE "support_contributions" ADD COLUMN "supporterEmail" VARCHAR(254),
  ADD COLUMN "supporterMessage" VARCHAR(500);
CREATE TABLE "support_notifications" (
  "id" UUID NOT NULL PRIMARY KEY,
  "contributionId" UUID NOT NULL REFERENCES "support_contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "audience" VARCHAR(12) NOT NULL CHECK ("audience" IN ('SUPPORTER','ADMIN')),
  "mode" VARCHAR(4) NOT NULL CHECK ("mode" IN ('TEST','LIVE')),
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PROCESSING','SENT','FAILED_RETRYABLE','REQUIRES_REVIEW','SUPPRESSED')),
  "recipient" VARCHAR(254), "idempotencyKey" VARCHAR(255) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMPTZ(3), "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3), "providerMessageId" VARCHAR(255),
  "sentAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("contributionId","audience"), UNIQUE ("idempotencyKey"), UNIQUE ("providerMessageId")
);
CREATE INDEX "support_notifications_mode_status_availableAt_idx" ON "support_notifications"("mode","status","availableAt");

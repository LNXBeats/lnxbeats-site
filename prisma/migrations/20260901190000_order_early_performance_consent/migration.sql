-- Store the distinct, server-versioned request to begin a music service
-- before the statutory withdrawal period ends. Historical orders remain
-- valid with a null proof; new checkout attempts fail closed in application
-- code until the complete current proof has been recorded.
ALTER TABLE "orders"
  ADD COLUMN "earlyPerformanceConsentVersion" VARCHAR(48),
  ADD COLUMN "earlyPerformanceConsentHashSha256" VARCHAR(64),
  ADD COLUMN "earlyPerformanceConsentAcceptedAt" TIMESTAMPTZ(3);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_early_performance_consent_complete" CHECK (
    (
      "earlyPerformanceConsentVersion" IS NULL
      AND "earlyPerformanceConsentHashSha256" IS NULL
      AND "earlyPerformanceConsentAcceptedAt" IS NULL
    )
    OR
    (
      "earlyPerformanceConsentVersion" IS NOT NULL
      AND "earlyPerformanceConsentHashSha256" ~ '^[0-9a-f]{64}$'
      AND "earlyPerformanceConsentAcceptedAt" IS NOT NULL
      AND "earlyPerformanceConsentAcceptedAt" >= "createdAt"
    )
  );

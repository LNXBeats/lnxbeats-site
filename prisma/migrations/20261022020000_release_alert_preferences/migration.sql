-- Optional release marketing only. No account is subscribed by this migration.
-- No changes to offers, contracts, transactional notifications or acquisitions.
CREATE TABLE "release_alert_preferences" (
  "userId" UUID NOT NULL PRIMARY KEY,
  "music" BOOLEAN NOT NULL DEFAULT false,
  "shop" BOOLEAN NOT NULL DEFAULT false,
  "editorial" BOOLEAN NOT NULL DEFAULT false,
  "musicConsentedAt" TIMESTAMPTZ(3),
  "shopConsentedAt" TIMESTAMPTZ(3),
  "editorialConsentedAt" TIMESTAMPTZ(3),
  "consentVersion" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(2) NOT NULL DEFAULT 'fr',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "release_alert_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "release_alert_preferences_locale_check" CHECK ("locale" IN ('fr','en','es','pt','zh','ja')),
  CONSTRAINT "release_alert_preferences_consent_check" CHECK (
    ("music" = ("musicConsentedAt" IS NOT NULL)) AND
    ("shop" = ("shopConsentedAt" IS NOT NULL)) AND
    ("editorial" = ("editorialConsentedAt" IS NOT NULL)))
);
CREATE TABLE "release_alert_preference_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL,
  "source" VARCHAR(24) NOT NULL,
  "consentVersion" VARCHAR(64) NOT NULL,
  "preferences" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_alert_preference_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "release_alert_preference_events_source_check" CHECK ("source" IN ('ACCOUNT','REGISTRATION','UNSUBSCRIBE'))
);
CREATE INDEX "release_alert_preference_events_userId_createdAt_idx" ON "release_alert_preference_events"("userId", "createdAt");
CREATE TABLE "release_publications" (
  "id" UUID NOT NULL PRIMARY KEY,
  "kind" VARCHAR(12) NOT NULL,
  "resourceId" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "baseline" BOOLEAN NOT NULL DEFAULT false,
  "expanded" BOOLEAN NOT NULL DEFAULT false,
  "recipientCursor" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_publications_kind_check" CHECK ("kind" IN ('MUSIC','SHOP','EDITORIAL'))
);
CREATE UNIQUE INDEX "release_publications_kind_resourceId_key" ON "release_publications"("kind", "resourceId");
CREATE INDEX "release_publications_baseline_expanded_createdAt_idx" ON "release_publications"("baseline", "expanded", "createdAt");
CREATE TABLE "release_alert_deliveries" (
  "id" UUID NOT NULL PRIMARY KEY,
  "publicationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "recipient" VARCHAR(320) NOT NULL,
  "deploymentEnvironment" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstAttemptAt" TIMESTAMPTZ(3),
  "leaseToken" UUID,
  "leaseUntil" TIMESTAMPTZ(3),
  "providerMessageId" VARCHAR(255),
  "lastErrorCode" VARCHAR(80),
  "sentAt" TIMESTAMPTZ(3),
  "deliveredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "release_alert_deliveries_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "release_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "release_alert_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "release_alert_deliveries_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "release_alert_deliveries_environment_check" CHECK ("deploymentEnvironment" IN ('development','staging','production')),
  CONSTRAINT "release_alert_deliveries_status_check" CHECK ("status" IN ('PENDING','PROCESSING','SENT','DELIVERED','FAILED_RETRYABLE','REQUIRES_REVIEW','CANCELED','BOUNCED','COMPLAINED','SUPPRESSED'))
);
CREATE UNIQUE INDEX "release_alert_deliveries_publicationId_userId_key" ON "release_alert_deliveries"("publicationId", "userId");
CREATE UNIQUE INDEX "release_alert_deliveries_providerMessageId_key" ON "release_alert_deliveries"("providerMessageId");
CREATE INDEX "release_alert_deliveries_status_availableAt_idx" ON "release_alert_deliveries"("status", "availableAt");
CREATE INDEX "release_alert_deliveries_status_leaseUntil_idx" ON "release_alert_deliveries"("status", "leaseUntil");

-- Deduplication markers only, zero deliveries. Existing public works are not news.
-- Also mark previously published-and-withdrawn shop/editorial resources where the
-- append-only audit provides that fact. No music history is guessed.
INSERT INTO "release_publications" ("id", "kind", "resourceId", "title", "path", "baseline", "expanded")
SELECT gen_random_uuid(), 'MUSIC', "id", "title", '/album/' || "slug", true, true
FROM "projects" WHERE "status" = 'PUBLISHED' AND "publicVisible" = true AND "type" IN ('SINGLE','ALBUM');
INSERT INTO "release_publications" ("id", "kind", "resourceId", "title", "path", "baseline", "expanded")
SELECT gen_random_uuid(), 'SHOP', p."id", p."title", '/boutique/' || p."slug", true, true
FROM "products" p WHERE p."status" = 'PUBLISHED' OR EXISTS (SELECT 1 FROM "product_audit_events" a WHERE a."productId" = p."id" AND a."action" = 'PUBLISHED');
INSERT INTO "release_publications" ("id", "kind", "resourceId", "title", "path", "baseline", "expanded")
SELECT gen_random_uuid(), 'EDITORIAL', "id", "title", '/creations/' || "slug", true, true
FROM "creations" WHERE "status" = 'PUBLISHED';

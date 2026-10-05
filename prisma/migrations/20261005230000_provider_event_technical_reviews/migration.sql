-- Additive, append-only technical review; no financial or order record is changed.
CREATE TABLE "provider_event_technical_reviews" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" VARCHAR(80) NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_event_technical_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_event_technical_reviews_reason_check"
    CHECK ("reason" = 'EXPIRED_UNPAID_SUPPORT_CHECKOUT'),
  CONSTRAINT "provider_event_technical_reviews_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "provider_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "provider_event_technical_reviews_eventId_key"
  ON "provider_event_technical_reviews"("eventId");

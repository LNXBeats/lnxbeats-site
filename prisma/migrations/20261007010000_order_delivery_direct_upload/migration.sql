-- Additive, isolated durable reservations/leases; no historical data rewritten.
CREATE TABLE "order_delivery_upload_sessions" (
  "id" UUID PRIMARY KEY,
  "tokenHash" CHAR(64) NOT NULL UNIQUE,
  "actorUserId" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PREPARING',
  "originalFilename" VARCHAR(255) NOT NULL,
  "declaredMimeType" VARCHAR(160) NOT NULL,
  "declaredSizeBytes" BIGINT NOT NULL CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 209715200),
  "storageKey" VARCHAR(500) NOT NULL UNIQUE,
  "providerUploadId" TEXT UNIQUE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "order_delivery_upload_status_check" CHECK ("status" IN
    ('PREPARING','UPLOADING','COMPLETING','QUARANTINE','VALIDATING','READY','REJECTED','ABORTED','EXPIRED'))
);
CREATE INDEX "order_delivery_upload_sessions_orderId_status_expiresAt_idx"
 ON "order_delivery_upload_sessions"("orderId", "status", "expiresAt");
CREATE INDEX "delivery_upload_status_lease_created_idx"
 ON "order_delivery_upload_sessions"("status", "leaseExpiresAt", "createdAt");

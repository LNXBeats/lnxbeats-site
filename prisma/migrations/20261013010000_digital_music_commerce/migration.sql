-- CreateTable
CREATE TABLE "digital_offers" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "projectId" UUID NOT NULL,
    "trackId" UUID,
    "priceCents" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "distribution" VARCHAR(20) NOT NULL DEFAULT 'UNRELEASED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_masters" (
    "id" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "masterAssetId" UUID NOT NULL,
    "previewAssetId" UUID,
    "previewStartMs" INTEGER NOT NULL DEFAULT 0,
    "previewDurationMs" INTEGER,
    "codec" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUARANTINED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_uploads" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "providerUploadId" VARCHAR(1000),
    "expectedVersion" INTEGER NOT NULL DEFAULT 0,
    "previewStartMs" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PREPARING',
    "errorCode" VARCHAR(80),
    "leaseUntil" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_carts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_cart_lines" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "selectionHash" CHAR(64),
    "priceCents" INTEGER NOT NULL,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_cart_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_orders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "cartRevision" INTEGER NOT NULL,
    "mode" VARCHAR(8) NOT NULL DEFAULT 'TEST',
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "totalCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "termsVersion" VARCHAR(80) NOT NULL,
    "termsHash" VARCHAR(64) NOT NULL,
    "earlyDelivery" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "trackSnapshot" JSONB NOT NULL,
    "taxSnapshot" JSONB NOT NULL,

    CONSTRAINT "digital_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_payment_attempts" (
    "operation" VARCHAR(12) NOT NULL DEFAULT 'CHECKOUT',
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" VARCHAR(10) NOT NULL,
    "idempotencyKey" VARCHAR(180) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATING',
    "providerReference" VARCHAR(255),
    "paymentReference" VARCHAR(255),
    "checkoutUrl" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_entitlements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "masterId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_events" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "actorId" UUID,
    "externalKey" VARCHAR(255),
    "kind" VARCHAR(60) NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_download_tickets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "masterId" UUID,
    "tokenHash" VARCHAR(64) NOT NULL,
    "usesLeft" INTEGER NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_download_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digital_offers_trackId_key" ON "digital_offers"("trackId");

-- CreateIndex
CREATE INDEX "digital_offers_projectId_scope_idx" ON "digital_offers"("projectId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "digital_masters_masterAssetId_key" ON "digital_masters"("masterAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_masters_previewAssetId_key" ON "digital_masters"("previewAssetId");

-- CreateIndex
CREATE INDEX "digital_masters_trackId_status_version_idx" ON "digital_masters"("trackId", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "digital_masters_trackId_version_key" ON "digital_masters"("trackId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "digital_uploads_storageKey_key" ON "digital_uploads"("storageKey");

-- CreateIndex
CREATE INDEX "digital_uploads_status_leaseUntil_idx" ON "digital_uploads"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "digital_carts_userId_key" ON "digital_carts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_cart_lines_cartId_offerId_key" ON "digital_cart_lines"("cartId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_orders_idempotencyKey_key" ON "digital_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "digital_orders_userId_createdAt_idx" ON "digital_orders"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "digital_order_lines_orderId_offerId_key" ON "digital_order_lines"("orderId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_payment_attempts_idempotencyKey_key" ON "digital_payment_attempts"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "digital_payment_attempts_providerReference_key" ON "digital_payment_attempts"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "digital_payment_attempts_paymentReference_key" ON "digital_payment_attempts"("paymentReference");

-- CreateIndex
CREATE INDEX "digital_payment_attempts_orderId_status_idx" ON "digital_payment_attempts"("orderId", "status");

-- CreateIndex
CREATE INDEX "digital_entitlements_userId_status_idx" ON "digital_entitlements"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "digital_entitlements_lineId_masterId_key" ON "digital_entitlements"("lineId", "masterId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_events_externalKey_key" ON "digital_events"("externalKey");

-- CreateIndex
CREATE INDEX "digital_events_orderId_createdAt_idx" ON "digital_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "digital_download_tickets_tokenHash_key" ON "digital_download_tickets"("tokenHash");

-- CreateIndex
CREATE INDEX "digital_download_tickets_expiresAt_idx" ON "digital_download_tickets"("expiresAt");

-- AddForeignKey
ALTER TABLE "digital_offers" ADD CONSTRAINT "digital_offers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_offers" ADD CONSTRAINT "digital_offers_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_masters" ADD CONSTRAINT "digital_masters_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_masters" ADD CONSTRAINT "digital_masters_masterAssetId_fkey" FOREIGN KEY ("masterAssetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_masters" ADD CONSTRAINT "digital_masters_previewAssetId_fkey" FOREIGN KEY ("previewAssetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_uploads" ADD CONSTRAINT "digital_uploads_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_uploads" ADD CONSTRAINT "digital_uploads_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_carts" ADD CONSTRAINT "digital_carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_cart_lines" ADD CONSTRAINT "digital_cart_lines_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "digital_carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_cart_lines" ADD CONSTRAINT "digital_cart_lines_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "digital_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_orders" ADD CONSTRAINT "digital_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_order_lines" ADD CONSTRAINT "digital_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "digital_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_order_lines" ADD CONSTRAINT "digital_order_lines_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "digital_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_payment_attempts" ADD CONSTRAINT "digital_payment_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "digital_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_entitlements" ADD CONSTRAINT "digital_entitlements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_entitlements" ADD CONSTRAINT "digital_entitlements_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "digital_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_entitlements" ADD CONSTRAINT "digital_entitlements_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "digital_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_events" ADD CONSTRAINT "digital_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "digital_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_download_tickets" ADD CONSTRAINT "digital_download_tickets_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "digital_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only this domain is modified. No data backfill, DROP, DELETE or UPDATE of historical tables.
CREATE UNIQUE INDEX digital_offer_album_unique ON digital_offers("projectId") WHERE scope = 'ALBUM';
ALTER TABLE digital_offers ADD CONSTRAINT digital_offer_valid CHECK (
  scope IN ('ALBUM','TRACK') AND ((scope='ALBUM' AND "trackId" IS NULL) OR (scope='TRACK' AND "trackId" IS NOT NULL))
  AND currency='EUR' AND version>0 AND ( "priceCents" IS NULL OR "priceCents" BETWEEN 1 AND 100000)
  AND (NOT active OR ("priceCents" IS NOT NULL AND "rightsConfirmed"))
  AND distribution IN ('UNRELEASED','DISTRIBUTED'));
ALTER TABLE digital_masters ADD CONSTRAINT digital_master_valid CHECK (
  version>0 AND "previewStartMs">=0 AND ("previewDurationMs" IS NULL OR "previewDurationMs" BETWEEN 1 AND 60000)
  AND status IN ('QUARANTINED','READY','FAILED')
  AND (status<>'READY' OR ("previewAssetId" IS NOT NULL AND "previewDurationMs" IS NOT NULL)));
ALTER TABLE digital_uploads ADD CONSTRAINT digital_upload_valid CHECK (
  "sizeBytes" BETWEEN 12 AND 536870912 AND "expectedVersion">=0 AND "previewStartMs">=0
  AND status IN ('PREPARING','UPLOADING','COMPLETING','QUARANTINE','VALIDATING','READY','REJECTED','ABORTED','EXPIRED'));
ALTER TABLE digital_orders ADD CONSTRAINT digital_order_valid CHECK (
  mode='TEST' AND currency='EUR' AND "totalCents" BETWEEN 1 AND 500000 AND "cartRevision">=0
  AND status IN ('PENDING','PAID','FAILED','REQUIRES_REVIEW','PARTIALLY_REFUNDED','REFUNDED','DISPUTED'));
ALTER TABLE digital_order_lines ADD CONSTRAINT digital_order_line_valid CHECK (
  scope IN ('ALBUM','TRACK') AND "priceCents" BETWEEN 1 AND 100000 AND "offerVersion">0
  AND jsonb_typeof("trackSnapshot")='array' AND jsonb_array_length("trackSnapshot")>0);
ALTER TABLE digital_payment_attempts ADD CONSTRAINT digital_attempt_valid CHECK (
  provider IN ('STRIPE','PAYPAL') AND operation IN ('CHECKOUT','CAPTURE') AND status IN ('CREATING','OPEN','UNKNOWN','CAPTURING','PAID','FAILED','PENDING'));
CREATE UNIQUE INDEX digital_one_active_attempt ON digital_payment_attempts("orderId")
  WHERE status IN ('CREATING','OPEN','UNKNOWN','CAPTURING','PENDING','PAID');
ALTER TABLE digital_entitlements ADD CONSTRAINT digital_entitlement_valid CHECK (status IN ('ACTIVE','REVOKED','SUSPENDED'));
ALTER TABLE digital_download_tickets ADD CONSTRAINT digital_ticket_valid CHECK ("usesLeft" BETWEEN 0 AND 3);
ALTER TABLE digital_cart_lines ADD CONSTRAINT digital_cart_line_valid CHECK ("priceCents">0 AND "offerVersion">0);
ALTER TABLE digital_cart_lines ADD CONSTRAINT digital_cart_selection_hash_valid CHECK ("selectionHash" IS NULL OR "selectionHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE digital_carts ADD CONSTRAINT digital_cart_revision_valid CHECK (revision>=0);
CREATE FUNCTION digital_verify_master_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW."masterAssetId" AND visibility='PRIVATE' AND type='AUDIO') THEN
    RAISE EXCEPTION 'digital master must be a private audio asset' USING ERRCODE='23514';
  END IF;
  IF NEW."previewAssetId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW."previewAssetId" AND visibility='PUBLIC' AND type='AUDIO_PREVIEW' AND duration_ms<=60000) THEN
    RAISE EXCEPTION 'digital preview must be an autonomous short public audio asset' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_master_visibility BEFORE INSERT OR UPDATE ON digital_masters FOR EACH ROW EXECUTE FUNCTION digital_verify_master_visibility();
CREATE FUNCTION digital_verify_entitlement_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM digital_order_lines l JOIN digital_orders o ON o.id=l."orderId" WHERE l.id=NEW."lineId" AND o."userId"=NEW."userId") THEN
    RAISE EXCEPTION 'digital entitlement owner mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER digital_entitlement_owner BEFORE INSERT ON digital_entitlements FOR EACH ROW EXECUTE FUNCTION digital_verify_entitlement_owner();

CREATE TABLE "external_shop_products" (
  "id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'DISTROKID',
  "providerLabel" VARCHAR(80) NOT NULL DEFAULT 'PRODUIT DÉRIVÉ · DISTROKID',
  "externalUrl" TEXT NOT NULL,
  "priceCents" INTEGER,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "position" INTEGER NOT NULL DEFAULT 0,
  "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "imageAssetId" UUID,
  "publishedAt" TIMESTAMPTZ(3),
  "archivedAt" TIMESTAMPTZ(3),
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByAdminId" UUID,
  "updatedByAdminId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "external_shop_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_shop_products_provider_check" CHECK ("provider" = 'DISTROKID'),
  CONSTRAINT "external_shop_products_currency_check" CHECK ("currency" = 'EUR'),
  CONSTRAINT "external_shop_products_price_check" CHECK ("priceCents" IS NULL OR "priceCents" > 0),
  CONSTRAINT "external_shop_products_position_check" CHECK ("position" >= 0),
  CONSTRAINT "external_shop_products_lock_version_check" CHECK ("lockVersion" > 0)
);

CREATE UNIQUE INDEX "external_shop_products_imageAssetId_key" ON "external_shop_products"("imageAssetId");
CREATE INDEX "external_shop_products_status_position_createdAt_idx" ON "external_shop_products"("status", "position", "createdAt");
CREATE INDEX "external_shop_products_createdByAdminId_idx" ON "external_shop_products"("createdByAdminId");
CREATE INDEX "external_shop_products_updatedByAdminId_idx" ON "external_shop_products"("updatedByAdminId");

ALTER TABLE "external_shop_products" ADD CONSTRAINT "external_shop_products_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_shop_products" ADD CONSTRAINT "external_shop_products_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_shop_products" ADD CONSTRAINT "external_shop_products_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "external_shop_product_audit_events" (
  "id" UUID NOT NULL,
  "externalShopProductId" UUID NOT NULL,
  "action" "ProductAuditAction" NOT NULL,
  "actorAdminId" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_shop_product_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_shop_product_audit_events_externalShopProductId_occurredAt_idx" ON "external_shop_product_audit_events"("externalShopProductId", "occurredAt");
CREATE INDEX "external_shop_product_audit_events_actorAdminId_idx" ON "external_shop_product_audit_events"("actorAdminId");

ALTER TABLE "external_shop_product_audit_events" ADD CONSTRAINT "external_shop_product_audit_events_externalShopProductId_fkey" FOREIGN KEY ("externalShopProductId") REFERENCES "external_shop_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_shop_product_audit_events" ADD CONSTRAINT "external_shop_product_audit_events_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

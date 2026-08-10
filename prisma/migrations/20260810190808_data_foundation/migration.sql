-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('ALBUM', 'SINGLE', 'PROJECT');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'IN_DEVELOPMENT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('DRAFT', 'ANNOUNCED', 'RELEASED', 'UNLISTED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('SPOTIFY', 'APPLE_MUSIC', 'DEEZER', 'YOUTUBE', 'AMAZON_MUSIC', 'DISTROKID', 'ETSY', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformScope" AS ENUM ('ARTIST', 'RELEASE', 'STORE');

-- CreateEnum
CREATE TYPE "CreditRole" AS ENUM ('ARTIST', 'WRITER', 'COMPOSER', 'PRODUCER', 'FEATURING', 'ENGINEER', 'OTHER');

-- CreateEnum
CREATE TYPE "DataConfidence" AS ENUM ('CONFIRMED', 'PARTIAL', 'PLACEHOLDER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConfidenceDomain" AS ENUM ('OVERALL', 'IDENTITY', 'EDITORIAL', 'RELEASE', 'ARTWORK', 'TRACKLIST', 'PLATFORMS', 'GENRES', 'CREDITS', 'SEO');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('COVER', 'HERO', 'IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "RightsStatus" AS ENUM ('UNKNOWN', 'PENDING', 'CLEARED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ProjectAssetRole" AS ENUM ('COVER', 'HERO', 'GALLERY', 'AUDIO', 'DOCUMENT', 'VIDEO');

-- CreateEnum
CREATE TYPE "OrderAssetRole" AS ENUM ('REFERENCE', 'DELIVERY', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWING', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "displayName" VARCHAR(120),
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120),
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "phone" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "subtitle" VARCHAR(240),
    "type" "ProjectType" NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "shortDescription" TEXT,
    "description" TEXT,
    "releaseDate" DATE,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "trackCount" INTEGER,
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "durationSeconds" INTEGER,
    "status" "TrackStatus" NOT NULL DEFAULT 'DRAFT',
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_links" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "platform" "Platform" NOT NULL,
    "scope" "PlatformScope" NOT NULL,
    "url" TEXT NOT NULL,
    "label" VARCHAR(180),
    "position" INTEGER NOT NULL DEFAULT 0,
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "trackId" UUID,
    "name" VARCHAR(180) NOT NULL,
    "role" "CreditRole" NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confidence_annotations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "domain" "ConfidenceDomain" NOT NULL,
    "level" "DataConfidence" NOT NULL,
    "source" VARCHAR(500),
    "note" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "confidence_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(160) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" VARCHAR(500),
    "rightsStatus" "RightsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rightsNote" TEXT,
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_assets" (
    "projectId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "ProjectAssetRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assets_pkey" PRIMARY KEY ("projectId","assetId","role")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNumber" VARCHAR(32) NOT NULL,
    "userId" UUID,
    "customerId" UUID,
    "customerEmail" VARCHAR(320) NOT NULL,
    "customerName" VARCHAR(200),
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(240),
    "brief" TEXT NOT NULL,
    "musicalDirection" TEXT,
    "emotion" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assets" (
    "orderId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "OrderAssetRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_assets_pkey" PRIMARY KEY ("orderId","assetId","role")
);

-- CreateTable
CREATE TABLE "favorites" (
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("userId","projectId")
);

-- AddCheckConstraint
ALTER TABLE "projects" ADD CONSTRAINT "projects_trackCount_nonnegative" CHECK ("trackCount" IS NULL OR "trackCount" >= 0);

-- AddCheckConstraint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_position_positive" CHECK ("position" > 0);

-- AddCheckConstraint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_durationSeconds_nonnegative" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);

-- AddCheckConstraint
ALTER TABLE "platform_links" ADD CONSTRAINT "platform_links_position_nonnegative" CHECK ("position" >= 0);

-- Global artist profiles are stored once, while release links must belong to a project.
-- Store links may be either global or project-specific.
-- AddCheckConstraint
ALTER TABLE "platform_links" ADD CONSTRAINT "platform_links_scope_project_consistent" CHECK (
    ("scope" = 'ARTIST' AND "projectId" IS NULL)
    OR ("scope" = 'RELEASE' AND "projectId" IS NOT NULL)
    OR "scope" = 'STORE'
);

-- A credit belongs to one project or one track, never both and never neither.
-- AddCheckConstraint
ALTER TABLE "credits" ADD CONSTRAINT "credits_single_parent" CHECK (num_nonnulls("projectId", "trackId") = 1);

-- AddCheckConstraint
ALTER TABLE "credits" ADD CONSTRAINT "credits_position_nonnegative" CHECK ("position" >= 0);

-- AddCheckConstraint
ALTER TABLE "assets" ADD CONSTRAINT "assets_sizeBytes_nonnegative" CHECK ("sizeBytes" >= 0);

-- AddCheckConstraint
ALTER TABLE "assets" ADD CONSTRAINT "assets_dimensions_positive" CHECK (
    ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0)
);

-- AddCheckConstraint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_position_nonnegative" CHECK ("position" >= 0);

-- AddCheckConstraint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_status_changes" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_createdAt_idx" ON "customers"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_status_featured_idx" ON "projects"("status", "featured");

-- CreateIndex
CREATE INDEX "projects_type_status_idx" ON "projects"("type", "status");

-- CreateIndex
CREATE INDEX "tracks_projectId_status_idx" ON "tracks"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_projectId_position_key" ON "tracks"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "platform_links_url_key" ON "platform_links"("url");

-- CreateIndex
CREATE INDEX "platform_links_projectId_scope_position_idx" ON "platform_links"("projectId", "scope", "position");

-- CreateIndex
CREATE INDEX "credits_projectId_position_idx" ON "credits"("projectId", "position");

-- CreateIndex
CREATE INDEX "credits_trackId_position_idx" ON "credits"("trackId", "position");

-- CreateIndex
CREATE INDEX "confidence_annotations_verifiedById_idx" ON "confidence_annotations"("verifiedById");

-- CreateIndex
CREATE UNIQUE INDEX "confidence_annotations_projectId_domain_key" ON "confidence_annotations"("projectId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storageKey_key" ON "assets"("storageKey");

-- CreateIndex
CREATE INDEX "assets_type_rightsStatus_idx" ON "assets"("type", "rightsStatus");

-- CreateIndex
CREATE INDEX "project_assets_projectId_role_position_idx" ON "project_assets"("projectId", "role", "position");

-- CreateIndex
CREATE INDEX "project_assets_assetId_idx" ON "project_assets"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_events_actorUserId_idx" ON "order_events"("actorUserId");

-- CreateIndex
CREATE INDEX "order_assets_assetId_idx" ON "order_assets"("assetId");

-- CreateIndex
CREATE INDEX "favorites_projectId_idx" ON "favorites"("projectId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_links" ADD CONSTRAINT "platform_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confidence_annotations" ADD CONSTRAINT "confidence_annotations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confidence_annotations" ADD CONSTRAINT "confidence_annotations_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assets" ADD CONSTRAINT "order_assets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assets" ADD CONSTRAINT "order_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

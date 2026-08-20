-- CreateEnum
CREATE TYPE "RightsRequestType" AS ENUM ('PUBLICATION_LICENSE', 'EXPLOITATION_PARTNERSHIP');

-- CreateEnum
CREATE TYPE "RightsRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INFORMATION_REQUIRED', 'UNDER_REVIEW', 'PREAUTHORIZATION_GENERATED', 'CONTRACT_PREPARATION', 'CONTRACT_READY', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED', 'READY_FOR_PAYMENT', 'REJECTED', 'CANCELLED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ContractPartyType" AS ENUM ('INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'ASSOCIATION_OR_OTHER');

-- CreateEnum
CREATE TYPE "RightsContributionKind" AS ENUM ('NONE', 'STORY_BRIEF_ONLY', 'LYRICS_FULL', 'LYRICS_PARTIAL', 'LYRICS_CO_WRITTEN', 'MELODY', 'MUSICAL_COMPOSITION', 'ARRANGEMENT', 'INSTRUMENTAL', 'ARTISTIC_DIRECTION', 'VOICE', 'MIX_MASTER', 'INSTRUMENTS', 'PRODUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AiContributionAssessment" AS ENUM ('NOT_REVIEWED', 'HUMAN_CONTRIBUTION_DOCUMENTED', 'LEGAL_REVIEW_REQUIRED', 'DECLARATION_NOT_RECOMMENDED', 'POTENTIALLY_ELIGIBLE');

-- CreateEnum
CREATE TYPE "RightsGrantKind" AS ENUM ('PUBLICATION', 'DISTRIBUTION', 'PUBLIC_COMMUNICATION', 'REPRODUCTION', 'MONETIZATION', 'ADAPTATION', 'ADVERTISING', 'AUDIOVISUAL_SYNCHRONIZATION', 'CONTENT_ID', 'SUBLICENSE', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractTemplateType" AS ENUM ('PUBLICATION_LICENSE', 'EXPLOITATION_PARTNERSHIP', 'SACEM_PREPARATION');

-- CreateEnum
CREATE TYPE "ContractTemplateStatus" AS ENUM ('DRAFT', 'AWAITING_LEGAL_REVIEW', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ContractDocumentKind" AS ENUM ('PREAUTHORIZATION', 'CONTRACT', 'ACCEPTANCE_RECEIPT', 'SACEM_PREPARATION');

-- CreateEnum
CREATE TYPE "ContractDocumentStatus" AS ENUM ('DRAFT', 'READY_FOR_CLIENT', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED', 'SUPERSEDED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ContractAcceptanceKind" AS ENUM ('CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "RightsEventType" AS ENUM ('REQUEST_CREATED', 'CONTACT_CONFIRMED', 'REQUEST_SUBMITTED', 'INFORMATION_REQUESTED', 'INFORMATION_PROVIDED', 'REVIEW_STARTED', 'PREAUTHORIZATION_GENERATED', 'CONTRACT_PARAMETERS_UPDATED', 'DOCUMENT_GENERATED', 'DOCUMENT_SUPERSEDED', 'DOCUMENT_VIEWED', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED', 'READY_FOR_PAYMENT', 'REQUEST_REJECTED', 'REQUEST_CANCELLED');

-- CreateEnum
CREATE TYPE "RightsMessageKind" AS ENUM ('ADMIN_REQUEST', 'CLIENT_RESPONSE');

-- Stable, concurrency-safe business numbering. Sequences are intentionally
-- independent from Prisma UUID primary keys.
CREATE SEQUENCE "lnx_rights_license_number_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "lnx_rights_partnership_number_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- AlterEnum
ALTER TYPE "OrderAssetRole" ADD VALUE 'CONTRACT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_RIGHTS_REQUESTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_INFORMATION_REQUIRED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_PREAUTHORIZATION_READY';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_CONTRACT_READY';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_RIGHTS_CLIENT_ACCEPTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_REJECTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_RIGHTS_READY_FOR_PAYMENT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "personalUseTermsAcceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "personalUseTermsHashSha256" VARCHAR(64),
ADD COLUMN     "personalUseTermsVersion" VARCHAR(48);

-- CreateTable
CREATE TABLE "rights_requests" (
    "id" UUID NOT NULL,
    "requestNumber" VARCHAR(32) NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "RightsRequestType" NOT NULL,
    "status" "RightsRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedPriceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "pricingVersion" VARCHAR(48) NOT NULL,
    "workTitle" VARCHAR(240) NOT NULL,
    "artistName" VARCHAR(180),
    "formVersion" VARCHAR(48) NOT NULL,
    "formData" JSONB NOT NULL,
    "aiAssessment" "AiContributionAssessment" NOT NULL DEFAULT 'NOT_REVIEWED',
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "needsInformationMessage" TEXT,
    "legacyCommercialLicenseId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rights_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_party_snapshots" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "partyType" "ContractPartyType" NOT NULL,
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "artistName" VARCHAR(180),
    "companyName" VARCHAR(240),
    "legalForm" VARCHAR(120),
    "legalRepresentative" VARCHAR(200),
    "streetAddress" VARCHAR(300) NOT NULL,
    "postalCode" VARCHAR(24) NOT NULL,
    "city" VARCHAR(140) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "siret" VARCHAR(14),
    "vatNumber" VARCHAR(32),
    "contractEmail" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(40),
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_party_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_contributions" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "kind" "RightsContributionKind" NOT NULL,
    "description" TEXT NOT NULL,
    "claimedPercentage" INTEGER,
    "evidenceNote" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_grants" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "kind" "RightsGrantKind" NOT NULL,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "destination" TEXT,
    "platforms" JSONB NOT NULL,
    "territory" VARCHAR(240),
    "duration" VARCHAR(240),
    "effectiveDate" DATE,
    "monetization" BOOLEAN NOT NULL DEFAULT false,
    "adaptation" BOOLEAN NOT NULL DEFAULT false,
    "advertising" BOOLEAN NOT NULL DEFAULT false,
    "audiovisualSync" BOOLEAN NOT NULL DEFAULT false,
    "contentId" BOOLEAN NOT NULL DEFAULT false,
    "sublicense" BOOLEAN NOT NULL DEFAULT false,
    "credit" TEXT,
    "restrictions" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rights_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_split_proposals" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "clientSharePercent" INTEGER NOT NULL,
    "lnxSharePercent" INTEGER NOT NULL,
    "nature" VARCHAR(200) NOT NULL,
    "comment" TEXT,
    "contributionRationale" TEXT NOT NULL,
    "proposedRoles" JSONB NOT NULL,
    "proposedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_split_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" UUID NOT NULL,
    "type" "ContractTemplateType" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "status" "ContractTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceMarkup" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "approvedByAdminId" UUID,
    "legalReviewReference" VARCHAR(240),

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_documents" (
    "id" UUID NOT NULL,
    "contractNumber" VARCHAR(32) NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "kind" "ContractDocumentKind" NOT NULL,
    "status" "ContractDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "adminAcceptedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),
    "priceSnapshotCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "documentHashSha256" VARCHAR(64) NOT NULL,
    "assetId" UUID NOT NULL,
    "retentionUntil" TIMESTAMPTZ(3),
    "supersedesDocumentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_acceptances" (
    "id" UUID NOT NULL,
    "contractDocumentId" UUID NOT NULL,
    "acceptedByUserId" UUID NOT NULL,
    "kind" "ContractAcceptanceKind" NOT NULL,
    "typedFullName" VARCHAR(200) NOT NULL,
    "documentHashSha256" VARCHAR(64) NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "orderId" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "sessionReferenceHash" VARCHAR(64) NOT NULL,
    "userAgentHash" VARCHAR(64),
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_request_events" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "type" "RightsEventType" NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "actorUserId" UUID,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_messages" (
    "id" UUID NOT NULL,
    "rightsRequestId" UUID NOT NULL,
    "kind" "RightsMessageKind" NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "requestedFields" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_messages_pkey" PRIMARY KEY ("id")
);

-- Browser-controlled values cannot redefine prices, currency, lifecycle,
-- acceptance evidence or legal-review state.
ALTER TABLE "orders" ADD CONSTRAINT "orders_personal_use_terms_complete" CHECK (
  ("personalUseTermsVersion" IS NULL AND "personalUseTermsHashSha256" IS NULL AND "personalUseTermsAcceptedAt" IS NULL)
  OR
  ("personalUseTermsVersion" IS NOT NULL AND "personalUseTermsHashSha256" ~ '^[0-9a-f]{64}$' AND "personalUseTermsAcceptedAt" IS NOT NULL)
);

ALTER TABLE "rights_requests" ADD CONSTRAINT "rights_requests_server_price" CHECK (
  "currency" = 'EUR'
  AND (
    ("type" = 'PUBLICATION_LICENSE' AND "requestedPriceCents" = 15000)
    OR
    ("type" = 'EXPLOITATION_PARTNERSHIP' AND "requestedPriceCents" = 150000)
  )
);
ALTER TABLE "rights_requests" ADD CONSTRAINT "rights_requests_timestamps" CHECK (
  ("status" = 'DRAFT' OR "submittedAt" IS NOT NULL)
  AND ("status" <> 'REJECTED' OR ("rejectedAt" IS NOT NULL AND length(trim("rejectionReason")) > 0))
  AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
);
ALTER TABLE "contract_party_snapshots" ADD CONSTRAINT "contract_party_snapshots_identity" CHECK (
  "country" ~ '^[A-Z]{2}$'
  AND length(trim("streetAddress")) > 0
  AND length(trim("postalCode")) > 0
  AND length(trim("city")) > 0
  AND position('@' IN "contractEmail") > 1
  AND (
    ("partyType" IN ('INDIVIDUAL', 'SOLE_PROPRIETOR') AND length(trim(coalesce("firstName", ''))) > 0 AND length(trim(coalesce("lastName", ''))) > 0)
    OR
    ("partyType" IN ('COMPANY', 'ASSOCIATION_OR_OTHER') AND length(trim(coalesce("companyName", ''))) > 0 AND length(trim(coalesce("legalRepresentative", ''))) > 0)
  )
);
ALTER TABLE "contract_party_snapshots" ADD CONSTRAINT "contract_party_snapshots_confirmation" CHECK (
  ("confirmedAt" IS NULL AND "confirmedByUserId" IS NULL)
  OR ("confirmedAt" IS NOT NULL AND "confirmedByUserId" IS NOT NULL)
);
ALTER TABLE "rights_contributions" ADD CONSTRAINT "rights_contributions_percentage" CHECK (
  "claimedPercentage" IS NULL OR "claimedPercentage" BETWEEN 0 AND 100
);
ALTER TABLE "rights_contributions" ADD CONSTRAINT "rights_contributions_description" CHECK (length(trim("description")) > 0);
ALTER TABLE "rights_split_proposals" ADD CONSTRAINT "rights_split_proposals_total" CHECK (
  "clientSharePercent" BETWEEN 0 AND 100
  AND "lnxSharePercent" BETWEEN 0 AND 100
  AND "clientSharePercent" + "lnxSharePercent" = 100
);
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_approval" CHECK (
  ("status" <> 'APPROVED')
  OR ("approvedAt" IS NOT NULL AND "approvedByAdminId" IS NOT NULL AND length(trim(coalesce("legalReviewReference", ''))) > 0)
);
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_retirement" CHECK (
  ("status" = 'RETIRED' AND "retiredAt" IS NOT NULL) OR ("status" <> 'RETIRED')
);
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_price" CHECK (
  "priceSnapshotCents" IN (15000, 150000) AND "currency" = 'EUR'
);
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_hash" CHECK ("documentHashSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_acceptance_dates" CHECK (
  ("status" NOT IN ('CLIENT_ACCEPTED', 'ADMIN_VALIDATED', 'ACTIVE') OR "acceptedAt" IS NOT NULL)
  AND ("status" NOT IN ('ADMIN_VALIDATED', 'ACTIVE') OR "adminAcceptedAt" IS NOT NULL)
  AND ("status" <> 'ACTIVE' OR ("activatedAt" IS NOT NULL AND "retentionUntil" IS NOT NULL))
);
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_hashes" CHECK (
  "documentHashSha256" ~ '^[0-9a-f]{64}$'
  AND "sessionReferenceHash" ~ '^[0-9a-f]{64}$'
  AND ("userAgentHash" IS NULL OR "userAgentHash" ~ '^[0-9a-f]{64}$')
  AND length(trim("typedFullName")) > 0
);
ALTER TABLE "rights_messages" ADD CONSTRAINT "rights_messages_body" CHECK (length(trim("body")) BETWEEN 1 AND 4000);

-- CreateIndex
CREATE UNIQUE INDEX "rights_requests_requestNumber_key" ON "rights_requests"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "rights_requests_legacyCommercialLicenseId_key" ON "rights_requests"("legacyCommercialLicenseId");

-- CreateIndex
CREATE INDEX "rights_requests_orderId_createdAt_idx" ON "rights_requests"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "rights_requests_userId_updatedAt_idx" ON "rights_requests"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "rights_requests_type_status_updatedAt_idx" ON "rights_requests"("type", "status", "updatedAt");

-- One active request of each offer per order. Rejected/cancelled history remains.
CREATE UNIQUE INDEX "rights_requests_one_active_type_per_order"
ON "rights_requests"("orderId", "type")
WHERE "status" IN ('DRAFT', 'SUBMITTED', 'INFORMATION_REQUIRED', 'UNDER_REVIEW', 'PREAUTHORIZATION_GENERATED', 'CONTRACT_PREPARATION', 'CONTRACT_READY', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED', 'READY_FOR_PAYMENT', 'ACTIVE');

-- CreateIndex
CREATE INDEX "contract_party_snapshots_confirmedByUserId_idx" ON "contract_party_snapshots"("confirmedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_party_snapshots_rightsRequestId_version_key" ON "contract_party_snapshots"("rightsRequestId", "version");

-- CreateIndex
CREATE INDEX "rights_contributions_rightsRequestId_position_idx" ON "rights_contributions"("rightsRequestId", "position");

-- CreateIndex
CREATE INDEX "rights_grants_rightsRequestId_position_idx" ON "rights_grants"("rightsRequestId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "rights_grants_rightsRequestId_kind_key" ON "rights_grants"("rightsRequestId", "kind");

-- CreateIndex
CREATE INDEX "rights_split_proposals_proposedByAdminId_idx" ON "rights_split_proposals"("proposedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "rights_split_proposals_rightsRequestId_version_key" ON "rights_split_proposals"("rightsRequestId", "version");

-- CreateIndex
CREATE INDEX "contract_templates_type_status_version_idx" ON "contract_templates"("type", "status", "version");

-- CreateIndex
CREATE INDEX "contract_templates_approvedByAdminId_idx" ON "contract_templates"("approvedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_type_version_key" ON "contract_templates"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_contractNumber_key" ON "contract_documents"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_assetId_key" ON "contract_documents"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_supersedesDocumentId_key" ON "contract_documents"("supersedesDocumentId");

-- CreateIndex
CREATE INDEX "contract_documents_rightsRequestId_createdAt_idx" ON "contract_documents"("rightsRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_documents_templateId_idx" ON "contract_documents"("templateId");

-- CreateIndex
CREATE INDEX "contract_documents_status_generatedAt_idx" ON "contract_documents"("status", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_rightsRequestId_kind_documentVersion_key" ON "contract_documents"("rightsRequestId", "kind", "documentVersion");

-- CreateIndex
CREATE INDEX "contract_acceptances_acceptedByUserId_acceptedAt_idx" ON "contract_acceptances"("acceptedByUserId", "acceptedAt");

-- CreateIndex
CREATE INDEX "contract_acceptances_rightsRequestId_acceptedAt_idx" ON "contract_acceptances"("rightsRequestId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contract_acceptances_contractDocumentId_kind_key" ON "contract_acceptances"("contractDocumentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "rights_request_events_idempotencyKey_key" ON "rights_request_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "rights_request_events_rightsRequestId_createdAt_idx" ON "rights_request_events"("rightsRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "rights_request_events_actorUserId_idx" ON "rights_request_events"("actorUserId");

-- CreateIndex
CREATE INDEX "rights_messages_rightsRequestId_createdAt_idx" ON "rights_messages"("rightsRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "rights_messages_authorUserId_idx" ON "rights_messages"("authorUserId");

-- AddForeignKey
ALTER TABLE "rights_requests" ADD CONSTRAINT "rights_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_requests" ADD CONSTRAINT "rights_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_party_snapshots" ADD CONSTRAINT "contract_party_snapshots_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_party_snapshots" ADD CONSTRAINT "contract_party_snapshots_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_contributions" ADD CONSTRAINT "rights_contributions_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_grants" ADD CONSTRAINT "rights_grants_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_split_proposals" ADD CONSTRAINT "rights_split_proposals_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_split_proposals" ADD CONSTRAINT "rights_split_proposals_proposedByAdminId_fkey" FOREIGN KEY ("proposedByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_supersedesDocumentId_fkey" FOREIGN KEY ("supersedesDocumentId") REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "contract_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_request_events" ADD CONSTRAINT "rights_request_events_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_request_events" ADD CONSTRAINT "rights_request_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_messages" ADD CONSTRAINT "rights_messages_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rights_messages" ADD CONSTRAINT "rights_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Models ship as legal drafts. Approval is never seeded and requires an Admin
-- plus a human legal-review reference through the guarded application service.
INSERT INTO "contract_templates" (
  "id", "type", "version", "title", "status", "sourceMarkup", "createdAt"
) VALUES
(
  gen_random_uuid(),
  'PUBLICATION_LICENSE',
  1,
  'Conditions particulières - Licence de publication',
  'DRAFT',
  '# CONDITIONS PARTICULIÈRES - PROJET\n\nContrat {{contractNumber}} - Commande {{orderNumber}} - Demande {{requestNumber}}\n\nParties : {{lnxIdentity}} et {{clientName}}, {{clientAddress}}.\n\nŒuvre : {{workTitle}} - Artiste : {{artistName}}.\n\nDroits envisagés : {{rightsMatrix}}.\nPlateformes : {{platforms}}. Territoire : {{territory}}. Durée : {{duration}}.\nMontant cible futur : {{price}}.\n\nLes droits non expressément accordés restent non accordés. Ce projet ne transfère ni la qualité d’auteur, ni les droits moraux, ni une quote-part SACEM. Revue juridique obligatoire.',
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid(),
  'EXPLOITATION_PARTNERSHIP',
  1,
  'Conditions particulières - Partenariat d’exploitation',
  'DRAFT',
  '# PARTENARIAT D’EXPLOITATION - PROJET\n\nContrat {{contractNumber}} - Commande {{orderNumber}} - Demande {{requestNumber}}\n\nParties : {{lnxIdentity}} et {{clientName}}, {{clientAddress}}.\nŒuvre : {{workTitle}} - Artiste : {{artistName}}.\n\nContributions et droits envisagés : {{rightsMatrix}}.\nProposition commerciale : {{proposedSplit}}.\nPlateformes : {{platforms}}. Territoire : {{territory}}. Durée : {{duration}}.\nMontant cible futur : {{price}}.\n\nCette proposition n’est pas automatiquement une clé de répartition SACEM et ne vaut ni déclaration ni garantie. Étude et revue juridique obligatoires.',
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid(),
  'SACEM_PREPARATION',
  1,
  'Fiche de préparation - Déclaration éventuelle',
  'DRAFT',
  '# FICHE DE PRÉPARATION - DÉCLARATION ÉVENTUELLE\n\nŒuvre {{workTitle}} - Demande {{requestNumber}}.\nContributions et rôles envisagés : {{rightsMatrix}}.\nProposition contractuelle : {{proposedSplit}}.\n\nCE DOCUMENT N’EST PAS UNE DÉCLARATION SACEM. IL RESTE PRIVÉ ET N’EST TRANSMIS AUTOMATIQUEMENT À AUCUN ORGANISME.',
  CURRENT_TIMESTAMP
);

-- Conservative one-way import of the former 1 500 EUR workflow. The archive
-- stays readable but no V0.7.2 code writes it. ACTIVE legacy rows are imported
-- as ADMIN_VALIDATED, never as automatically active rights.
INSERT INTO "rights_requests" (
  "id", "requestNumber", "orderId", "userId", "type", "status",
  "requestedPriceCents", "currency", "pricingVersion", "workTitle",
  "artistName", "formVersion", "formData", "aiAssessment", "submittedAt",
  "reviewedAt", "approvedAt", "rejectedAt", "cancelledAt", "rejectionReason",
  "legacyCommercialLicenseId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  format('LNX-PART-%s-%s', EXTRACT(YEAR FROM cl."requestedAt")::int, lpad(nextval('lnx_rights_partnership_number_seq')::text, 6, '0')),
  cl."orderId",
  o."userId",
  'EXPLOITATION_PARTNERSHIP',
  CASE cl."status"
    WHEN 'REQUESTED' THEN 'SUBMITTED'::"RightsRequestStatus"
    WHEN 'CONTRACT_PENDING' THEN 'CONTRACT_PREPARATION'::"RightsRequestStatus"
    WHEN 'PAYMENT_PENDING' THEN 'READY_FOR_PAYMENT'::"RightsRequestStatus"
    WHEN 'ACTIVE' THEN 'ADMIN_VALIDATED'::"RightsRequestStatus"
    WHEN 'REJECTED' THEN 'REJECTED'::"RightsRequestStatus"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"RightsRequestStatus"
  END,
  150000,
  'EUR',
  'legacy-2026-08-rights-v1',
  coalesce(nullif(trim(o."title"), ''), nullif(trim(o."recipient"), ''), 'Création liée à ' || o."orderNumber"),
  NULL,
  'legacy-import-v1',
  jsonb_build_object('legacyImported', true, 'manualReviewRequired', true),
  'LEGAL_REVIEW_REQUIRED',
  cl."requestedAt",
  cl."approvedAt",
  NULL,
  CASE WHEN cl."status" = 'REJECTED' THEN cl."updatedAt" ELSE NULL END,
  CASE WHEN cl."status" = 'CANCELLED' THEN cl."updatedAt" ELSE NULL END,
  CASE WHEN cl."status" = 'REJECTED' THEN 'Motif historique non structuré - revue Admin requise.' ELSE NULL END,
  cl."id",
  cl."createdAt",
  cl."updatedAt"
FROM "commercial_licenses" cl
JOIN "orders" o ON o."id" = cl."orderId"
WHERE o."userId" IS NOT NULL;

CREATE OR REPLACE FUNCTION "lnx_contract_template_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'APPROVED' THEN
    IF NEW."approvedByAdminId" IS NULL OR NEW."approvedAt" IS NULL OR length(trim(coalesce(NEW."legalReviewReference", ''))) = 0 THEN
      RAISE EXCEPTION 'LEGAL_REVIEW_REQUIRED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."approvedByAdminId" AND "role" = 'ADMIN' AND "status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'ADMIN_APPROVAL_REQUIRED';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "contract_documents" WHERE "templateId" = OLD."id") THEN
    IF NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."sourceMarkup" IS DISTINCT FROM OLD."sourceMarkup"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'USED_TEMPLATE_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "contract_templates_legal_guard"
BEFORE INSERT OR UPDATE ON "contract_templates"
FOR EACH ROW EXECUTE FUNCTION "lnx_contract_template_guard"();

CREATE OR REPLACE FUNCTION "lnx_contract_document_immutable_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM "contract_acceptances" WHERE "contractDocumentId" = OLD."id") THEN
    RAISE EXCEPTION 'ACCEPTED_DOCUMENT_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "contract_acceptances" WHERE "contractDocumentId" = OLD."id") THEN
    IF NEW."rightsRequestId" IS DISTINCT FROM OLD."rightsRequestId"
      OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
      OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
      OR NEW."documentVersion" IS DISTINCT FROM OLD."documentVersion"
      OR NEW."kind" IS DISTINCT FROM OLD."kind"
      OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
      OR NEW."priceSnapshotCents" IS DISTINCT FROM OLD."priceSnapshotCents"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot"
      OR NEW."documentHashSha256" IS DISTINCT FROM OLD."documentHashSha256"
      OR NEW."assetId" IS DISTINCT FROM OLD."assetId"
      OR NEW."supersedesDocumentId" IS DISTINCT FROM OLD."supersedesDocumentId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'ACCEPTED_DOCUMENT_IMMUTABLE';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "contract_documents_immutable_guard"
BEFORE UPDATE OR DELETE ON "contract_documents"
FOR EACH ROW EXECUTE FUNCTION "lnx_contract_document_immutable_guard"();

-- V0.7.2 can prepare and accept drafts, but it cannot activate rights. This
-- database gate deliberately requires a future migration, not an environment
-- flag or UI toggle, before either business object can become ACTIVE.
CREATE OR REPLACE FUNCTION "lnx_rights_v072_no_activation"() RETURNS trigger AS $$
BEGIN
  IF NEW."status"::text = 'ACTIVE' THEN
    RAISE EXCEPTION 'RIGHTS_ACTIVATION_NOT_IMPLEMENTED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "rights_requests_no_activation"
BEFORE INSERT OR UPDATE ON "rights_requests"
FOR EACH ROW EXECUTE FUNCTION "lnx_rights_v072_no_activation"();
CREATE TRIGGER "contract_documents_no_activation"
BEFORE INSERT OR UPDATE ON "contract_documents"
FOR EACH ROW EXECUTE FUNCTION "lnx_rights_v072_no_activation"();

-- RenameIndex
ALTER INDEX "projects_publicVisible_jukeboxPlacement_jukeboxPosition_catalog" RENAME TO "projects_publicVisible_jukeboxPlacement_jukeboxPosition_cat_idx";

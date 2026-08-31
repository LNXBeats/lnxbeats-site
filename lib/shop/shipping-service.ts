import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { PHASE5A_QA_SHIPPING_RATE, PHASE5E_COLISSIMO_FRANCE_2026_RATE } from "@/data/shop-shipping";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseShopShippingConfiguration } from "@/lib/shop/shipping-config";
import {
  quoteShipping,
  ShippingQuoteError,
  type ShippingQuote,
  type ShippingQuoteLine,
} from "@/lib/shop/shipping-domain";

type Transaction = Prisma.TransactionClient;
type Database = PrismaClient | Transaction;

export class ShopShippingServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SHIPPING_DISABLED"
      | "SHIPPING_CONFIGURATION_INVALID"
      | "SHIPPING_RATE_MISSING"
      | "SHIPPING_QUOTE_INVALID"
      | "SHIPPING_FIXTURE_CONFLICT",
  ) {
    super(message);
    this.name = "ShopShippingServiceError";
  }
}
const rateInclude = {
  tiers: { orderBy: [{ position: "asc" as const }, { maxWeightGrams: "asc" as const }] },
  packagingProfile: true,
} satisfies Prisma.ShippingRateVersionInclude;

export const SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION = "ACTIVATE_COLISSIMO_FRANCE_2026_CANDIDATE";

function requireEnabledConfiguration() {
  try {
    const configuration = parseShopShippingConfiguration();
    if (!configuration.enabled) {
      throw new ShopShippingServiceError(
        "La tarification logistique n’est pas activée pour cette QA.",
        "SHIPPING_DISABLED",
      );
    }
    return configuration;
  } catch (error) {
    if (error instanceof ShopShippingServiceError) throw error;
    throw new ShopShippingServiceError(
      "La configuration logistique locale est invalide.",
      "SHIPPING_CONFIGURATION_INVALID",
    );
  }
}

export async function quoteVersionedShopShipping(
  database: Database,
  input: Readonly<{
    lines: readonly ShippingQuoteLine[];
    destinationCountryCode: string;
  }>,
): Promise<ShippingQuote> {
  const configuration = requireEnabledConfiguration();
  const rate = await database.shippingRateVersion.findFirst({
    where: { status: "ACTIVE", scope: configuration.scope },
    include: rateInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!rate) {
    throw new ShopShippingServiceError(
      "Aucune grille logistique QA active n’est disponible.",
      "SHIPPING_RATE_MISSING",
    );
  }
  try {
    return quoteShipping({ rate, ...input });
  } catch (error) {
    if (error instanceof ShippingQuoteError) {
      throw new ShopShippingServiceError(error.message, "SHIPPING_QUOTE_INVALID");
    }
    throw error;
  }
}

export async function listAdminShippingRateVersions() {
  assertDatabaseConfigured();
  return prisma.shippingRateVersion.findMany({
    include: rateInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function listAdminPackagingProfiles() {
  assertDatabaseConfigured();
  return prisma.packagingProfile.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

export async function ensurePhase5AQaShippingRate(database: Database = prisma) {
  requireEnabledConfiguration();
  const fixture = PHASE5A_QA_SHIPPING_RATE;
  const existing = await database.shippingRateVersion.findUnique({
    where: { version: fixture.version },
    include: rateInclude,
  });
  if (existing) {
    const comparable = {
      status: existing.status,
      scope: existing.scope,
      service: existing.service,
      currency: existing.currency,
      countryCode: existing.countryCode,
      minimumBillableWeightGrams: existing.minimumBillableWeightGrams,
      packagingWeightGrams: existing.packagingWeightGrams,
      tiers: existing.tiers.map(({ position, maxWeightGrams, priceCents }) => ({
        position,
        maxWeightGrams,
        priceCents,
      })),
    };
    if (JSON.stringify(comparable) !== JSON.stringify({
      status: fixture.status,
      scope: fixture.scope,
      service: fixture.service,
      currency: fixture.currency,
      countryCode: fixture.countryCode,
      minimumBillableWeightGrams: fixture.minimumBillableWeightGrams,
      packagingWeightGrams: fixture.packagingWeightGrams,
      tiers: fixture.tiers,
    })) {
      throw new ShopShippingServiceError(
        "La fixture logistique QA existe avec une définition différente.",
        "SHIPPING_FIXTURE_CONFLICT",
      );
    }
    return existing;
  }
  const now = new Date();
  return database.shippingRateVersion.create({
    data: {
      version: fixture.version,
      status: fixture.status,
      scope: fixture.scope,
      service: fixture.service,
      currency: fixture.currency,
      countryCode: fixture.countryCode,
      minimumBillableWeightGrams: fixture.minimumBillableWeightGrams,
      packagingWeightGrams: fixture.packagingWeightGrams,
      activatedAt: now,
      tiers: { create: fixture.tiers.map((tier) => ({ ...tier })) },
    },
    include: rateInclude,
  });
}

export async function ensurePhase5ECommercialCandidate(database: Database = prisma) {
  const configuration = requireEnabledConfiguration();
  if (configuration.scope !== "COMMERCIAL_CANDIDATE") {
    throw new ShopShippingServiceError("Le contexte Phase 5E commercial est requis.", "SHIPPING_CONFIGURATION_INVALID");
  }
  const fixture = PHASE5E_COLISSIMO_FRANCE_2026_RATE;
  const packaging = await database.packagingProfile.upsert({
    where: { version: fixture.packaging.version },
    update: {},
    create: {
      version: fixture.packaging.version,
      name: fixture.packaging.name,
      status: fixture.packaging.status,
      physicalWeightGrams: fixture.packaging.physicalWeightGrams,
      maximumItemQuantity: fixture.packaging.maximumItemQuantity,
      customerBillableWeightIncluded: fixture.packaging.customerBillableWeightIncluded,
    },
  });
  const existing = await database.shippingRateVersion.findUnique({ where: { version: fixture.version }, include: rateInclude });
  if (existing) return existing;
  return database.shippingRateVersion.create({
    data: {
      version: fixture.version,
      status: fixture.status,
      scope: fixture.scope,
      service: fixture.service,
      currency: fixture.currency,
      countryCode: fixture.countryCode,
      minimumBillableWeightGrams: fixture.minimumBillableWeightGrams,
      packagingWeightGrams: fixture.packagingWeightGrams,
      billableWeightPolicy: fixture.billableWeightPolicy,
      packagingProfileId: packaging.id,
      sourceLabel: fixture.sourceLabel,
      validFrom: new Date(`${fixture.validFrom}T00:00:00.000Z`),
      tiers: { create: fixture.tiers.map((tier) => ({ ...tier })) },
    },
    include: rateInclude,
  });
}

export async function activatePhase5ECommercialRate(
  version: string,
  actorAdminId: string,
  confirmation: string,
  now = new Date(),
) {
  assertDatabaseConfigured();
  const configuration = requireEnabledConfiguration();
  if (
    configuration.scope !== "COMMERCIAL_CANDIDATE"
    || confirmation !== SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION
    || !actorAdminId
  ) throw new ShopShippingServiceError("L’activation explicite Admin est requise.", "SHIPPING_CONFIGURATION_INVALID");
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('shop-shipping-commercial-rate-activation')) IS NULL AS locked`;
    const target = await transaction.shippingRateVersion.findUnique({ where: { version }, include: rateInclude });
    if (!target || target.scope !== "COMMERCIAL_CANDIDATE" || target.status !== "DRAFT" || !target.packagingProfile) {
      throw new ShopShippingServiceError("La grille candidate n’est pas activable.", "SHIPPING_RATE_MISSING");
    }
    if (target.packagingProfile.customerBillableWeightIncluded) {
      throw new ShopShippingServiceError("L’emballage ne peut pas être facturé au client.", "SHIPPING_FIXTURE_CONFLICT");
    }
    await transaction.shippingRateVersion.updateMany({
      where: { scope: "COMMERCIAL_CANDIDATE", status: "ACTIVE", id: { not: target.id } },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    await transaction.packagingProfile.updateMany({
      where: { status: "ACTIVE", id: { not: target.packagingProfile.id } },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    await transaction.packagingProfile.update({
      where: { id: target.packagingProfile.id },
      data: { status: "ACTIVE", activatedAt: target.packagingProfile.activatedAt ?? now },
    });
    return transaction.shippingRateVersion.update({
      where: { id: target.id },
      data: { status: "ACTIVE", activatedAt: target.activatedAt ?? now },
      include: rateInclude,
    });
  });
}

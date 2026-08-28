import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { PHASE5A_QA_SHIPPING_RATE } from "@/data/shop-shipping";
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
} satisfies Prisma.ShippingRateVersionInclude;

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

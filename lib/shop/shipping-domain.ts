const MAX_WEIGHT_GRAMS = 1_000_000;
const MAX_PRODUCT_WEIGHT_GRAMS = 30_000;
const MAX_SHIPPING_CENTS = 100_000_000;
const VERSION_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;

export const SHOP_SHIPPING_SERVICE = "STANDARD_TRACKED_SIGNATURE" as const;
export const SHOP_SHIPPING_SCOPE = "INTERNAL_QA" as const;
export const SHOP_COMMERCIAL_SHIPPING_SERVICE = "COLISSIMO_HOME_FRANCE" as const;
export const SHOP_COMMERCIAL_SHIPPING_SCOPE = "COMMERCIAL_CANDIDATE" as const;
export const SHOP_SHIPPING_CURRENCY = "EUR" as const;
export const SHOP_SHIPPING_COUNTRY = "FR" as const;
export const SHOP_SHIPPING_MINIMUM_BILLABLE_GRAMS = 150;
export const SHOP_SHIPPING_MAX_PRODUCT_GRAMS = MAX_PRODUCT_WEIGHT_GRAMS;

export type ShippingRateTierDefinition = Readonly<{
  position: number;
  maxWeightGrams: number;
  priceCents: number;
}>;

export type ShippingRateDefinition = Readonly<{
  id: string;
  version: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | "RETIRED";
  scope: "INTERNAL_QA" | "COMMERCIAL_CANDIDATE";
  service: "STANDARD_TRACKED_SIGNATURE" | "COLISSIMO_HOME_FRANCE";
  currency: string;
  countryCode: string;
  minimumBillableWeightGrams: number;
  packagingWeightGrams: number;
  billableWeightPolicy?: "PACKAGED" | "PRODUCTS_ONLY";
  packagingProfile?: Readonly<{
    id: string;
    version: string;
    physicalWeightGrams: number;
    maximumItemQuantity: number;
    customerBillableWeightIncluded: boolean;
  }> | null;
  tiers: readonly ShippingRateTierDefinition[];
}>;

export type ShippingQuoteLine = Readonly<{
  productId: string;
  shippingRequired: boolean;
  shippingWeightGrams: number | null;
  quantity: number;
}>;

export type ShippingQuote = Readonly<{
  required: true;
  rateVersionId: string;
  version: string;
  service: "STANDARD_TRACKED_SIGNATURE" | "COLISSIMO_HOME_FRANCE";
  currency: "EUR";
  countryCode: "FR";
  productWeightGrams: number;
  packagingWeightGrams: number;
  physicalWeightGrams: number;
  billableWeightGrams: number;
  billableWeightPolicy: "PACKAGED" | "PRODUCTS_ONLY";
  packagingProfileId: string | null;
  packagingProfileVersion: string | null;
  amountCents: number;
  tierPosition: number;
  tierMaximumWeightGrams: number;
}>;

export class ShippingQuoteError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_RATE"
      | "INACTIVE_RATE"
      | "UNSUPPORTED_DESTINATION"
      | "PRODUCT_WEIGHT_REQUIRED"
      | "WEIGHT_OVERFLOW"
      | "RATE_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "ShippingQuoteError";
  }
}
function boundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validateRate(rate: ShippingRateDefinition) {
  const expectedService = rate.scope === SHOP_COMMERCIAL_SHIPPING_SCOPE
    ? SHOP_COMMERCIAL_SHIPPING_SERVICE
    : SHOP_SHIPPING_SERVICE;
  if (
    !rate.id
    || !VERSION_PATTERN.test(rate.version)
    || ![SHOP_SHIPPING_SCOPE, SHOP_COMMERCIAL_SHIPPING_SCOPE].includes(rate.scope)
    || rate.service !== expectedService
    || rate.currency !== SHOP_SHIPPING_CURRENCY
    || rate.countryCode !== SHOP_SHIPPING_COUNTRY
    || !boundedInteger(rate.minimumBillableWeightGrams, 1, MAX_WEIGHT_GRAMS)
    || !boundedInteger(rate.packagingWeightGrams, 0, MAX_WEIGHT_GRAMS)
    || !["PACKAGED", "PRODUCTS_ONLY"].includes(rate.billableWeightPolicy ?? "PACKAGED")
    || !rate.tiers.length
  ) {
    throw new ShippingQuoteError("La grille logistique est invalide.", "INVALID_RATE");
  }
  if (rate.packagingProfile && (
    !rate.packagingProfile.id
    || !VERSION_PATTERN.test(rate.packagingProfile.version)
    || !boundedInteger(rate.packagingProfile.physicalWeightGrams, 0, MAX_WEIGHT_GRAMS)
    || !boundedInteger(rate.packagingProfile.maximumItemQuantity, 1, 1_000)
    || rate.packagingProfile.customerBillableWeightIncluded
    || rate.packagingProfile.physicalWeightGrams !== rate.packagingWeightGrams
  )) throw new ShippingQuoteError("Le profil d’emballage est invalide.", "INVALID_RATE");
  if (rate.status !== "ACTIVE") {
    throw new ShippingQuoteError("La grille logistique n’est pas active.", "INACTIVE_RATE");
  }

  let previousMaximum = 0;
  for (const [index, tier] of rate.tiers.entries()) {
    if (
      tier.position !== index
      || !boundedInteger(tier.maxWeightGrams, 1, MAX_WEIGHT_GRAMS)
      || tier.maxWeightGrams <= previousMaximum
      || !boundedInteger(tier.priceCents, 1, MAX_SHIPPING_CENTS)
    ) {
      throw new ShippingQuoteError("Les paliers logistiques sont incohérents.", "INVALID_RATE");
    }
    previousMaximum = tier.maxWeightGrams;
  }
}

function checkedProductWeight(weightGrams: number, quantity: number) {
  if (
    !boundedInteger(weightGrams, 1, MAX_PRODUCT_WEIGHT_GRAMS)
    || !boundedInteger(quantity, 1, 20)
  ) {
    throw new ShippingQuoteError("Le poids logistique du produit est requis.", "PRODUCT_WEIGHT_REQUIRED");
  }
  const lineWeight = weightGrams * quantity;
  if (!boundedInteger(lineWeight, 1, MAX_WEIGHT_GRAMS)) {
    throw new ShippingQuoteError("Le poids logistique calculé est trop élevé.", "WEIGHT_OVERFLOW");
  }
  return lineWeight;
}

export function quoteShipping(input: Readonly<{
  rate: ShippingRateDefinition;
  lines: readonly ShippingQuoteLine[];
  destinationCountryCode: string;
}>): ShippingQuote {
  validateRate(input.rate);
  if (input.destinationCountryCode !== input.rate.countryCode) {
    throw new ShippingQuoteError(
      "La livraison n’est pas disponible pour cette destination.",
      "UNSUPPORTED_DESTINATION",
    );
  }

  const shippable = input.lines.filter((line) => line.shippingRequired);
  if (!shippable.length) {
    throw new ShippingQuoteError("Aucun produit expédiable n’est présent.", "PRODUCT_WEIGHT_REQUIRED");
  }
  let productWeightGrams = 0;
  let physicalItemQuantity = 0;
  for (const line of shippable) {
    if (line.shippingWeightGrams === null) {
      throw new ShippingQuoteError(
        "Un produit doit recevoir un poids logistique avant la commande.",
        "PRODUCT_WEIGHT_REQUIRED",
      );
    }
    const lineWeight = checkedProductWeight(line.shippingWeightGrams, line.quantity);
    physicalItemQuantity += line.quantity;
    productWeightGrams += lineWeight;
    if (!boundedInteger(productWeightGrams, 1, MAX_WEIGHT_GRAMS)) {
      throw new ShippingQuoteError("Le poids logistique calculé est trop élevé.", "WEIGHT_OVERFLOW");
    }
  }
  if (input.rate.packagingProfile && physicalItemQuantity > input.rate.packagingProfile.maximumItemQuantity) {
    throw new ShippingQuoteError("Le panier dépasse la capacité de l’emballage disponible.", "RATE_LIMIT_EXCEEDED");
  }

  const packagingWeightGrams = input.rate.packagingProfile?.physicalWeightGrams ?? input.rate.packagingWeightGrams;
  const packedWeightGrams = productWeightGrams + packagingWeightGrams;
  if (!boundedInteger(packedWeightGrams, 1, MAX_WEIGHT_GRAMS)) {
    throw new ShippingQuoteError("Le poids emballé calculé est trop élevé.", "WEIGHT_OVERFLOW");
  }
  const billableWeightPolicy = input.rate.billableWeightPolicy ?? "PACKAGED";
  const billableBasisGrams = billableWeightPolicy === "PRODUCTS_ONLY" ? productWeightGrams : packedWeightGrams;
  const billableWeightGrams = Math.max(
    input.rate.minimumBillableWeightGrams,
    billableBasisGrams,
  );
  const tier = input.rate.tiers.find(({ maxWeightGrams }) => billableWeightGrams <= maxWeightGrams);
  if (!tier) {
    throw new ShippingQuoteError(
      "Le poids dépasse la grille logistique disponible.",
      "RATE_LIMIT_EXCEEDED",
    );
  }

  return Object.freeze({
    required: true,
    rateVersionId: input.rate.id,
    version: input.rate.version,
    service: input.rate.service,
    currency: SHOP_SHIPPING_CURRENCY,
    countryCode: SHOP_SHIPPING_COUNTRY,
    productWeightGrams,
    packagingWeightGrams,
    physicalWeightGrams: packedWeightGrams,
    billableWeightGrams,
    billableWeightPolicy,
    packagingProfileId: input.rate.packagingProfile?.id ?? null,
    packagingProfileVersion: input.rate.packagingProfile?.version ?? null,
    amountCents: tier.priceCents,
    tierPosition: tier.position,
    tierMaximumWeightGrams: tier.maxWeightGrams,
  });
}

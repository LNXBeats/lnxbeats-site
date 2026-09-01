export const orderPricingVersions = {
  "2026-08-v1": {
    currency: "EUR",
    personalBaseCents: 5_000,
    coverCents: 1_000,
    priorityCents: 3_000,
  },
  "2026-08-v2": {
    currency: "EUR",
    personalBaseCents: 2_000,
    coverCents: 1_000,
    priorityCents: 3_000,
  },
} as const;

export type OrderPricingVersion = keyof typeof orderPricingVersions;

export function orderPricingForVersion(version: string) {
  return orderPricingVersions[version as OrderPricingVersion];
}

const currentOrderPricingVersion = "2026-08-v2" as const;

export const orderOffer = {
  pricingVersion: currentOrderPricingVersion,
  ...orderPricingVersions[currentOrderPricingVersion],
  revisionAllowance: 1,
  deliveryFormat: "WAV",
  indicativeDelay: "14 jours",
  priorityDelay: "Délai prioritaire confirmé lors de la prise en charge.",
  maxActiveDrafts: 10,
  maxPhotos: 10,
  maxPhotoBytes: 10 * 1024 * 1024,
  maxDeliveryBytes: 200 * 1024 * 1024,
  maxImageWidth: 12_000,
  maxImageHeight: 12_000,
  maxImagePixels: 40_000_000,
} as const;

export const earlyPerformanceConsentWording =
  "Je demande expressément que LNX Beats commence l’exécution de ma commande dès la confirmation du paiement, avant la fin du délai légal de rétractation de 14 jours. Je reconnais qu’une fois la prestation entièrement exécutée, je ne pourrai plus exercer mon droit de rétractation.";

export type OrderUsage = "PERSONAL" | "COMMERCIAL_EXTENDED";

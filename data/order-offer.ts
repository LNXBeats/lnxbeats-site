export const orderOffer = {
  pricingVersion: "2026-08-v1",
  currency: "EUR",
  personalBaseCents: 5_000,
  commercialExtendedBaseCents: 150_000,
  coverCents: 1_000,
  priorityCents: 3_000,
  revisionAllowance: 1,
  deliveryFormat: "WAV",
  indicativeDelay: "7 à 14 jours",
  priorityDelay: "Délai prioritaire confirmé lors de la prise en charge.",
  maxActiveDrafts: 10,
  maxPhotos: 10,
  maxPhotoBytes: 10 * 1024 * 1024,
  maxImageWidth: 12_000,
  maxImageHeight: 12_000,
  maxImagePixels: 40_000_000,
} as const;

export type OrderUsage = "PERSONAL" | "COMMERCIAL_EXTENDED";

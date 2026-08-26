import "server-only";

export const MUSIC_PRICING_CONFIGURATION_KEY = "music-order" as const;
export const MUSIC_PRICING_CURRENCY = "EUR" as const;
export const MUSIC_PRICING_ACTIVATION_CONFIRMATION = "CONFIRM_NEW_MUSIC_PRICING" as const;

const MAX_COMPONENT_PRICE_CENTS = 1_000_000;

export type MusicPricingDraftInput = {
  currency: unknown;
  basePrice: unknown;
  coverPrice: unknown;
  priorityPrice: unknown;
};

export type ValidatedMusicPricingDraft = {
  currency: typeof MUSIC_PRICING_CURRENCY;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
};

export type MusicPricingValidationErrorCode =
  | "INVALID_AMOUNT"
  | "AMOUNT_OUT_OF_RANGE"
  | "UNSUPPORTED_CURRENCY"
  | "INVALID_REVISION";

export class MusicPricingValidationError extends Error {
  constructor(readonly code: MusicPricingValidationErrorCode, message: string) {
    super(message);
    this.name = "MusicPricingValidationError";
  }
}

/**
 * Parses a human-entered EUR amount without ever passing through floating point.
 * Accepted examples: 20, 20,00 and 25.50. Scientific notation, signs and more
 * than two decimal places are rejected.
 */
export function parseEuroAmountToCents(
  value: unknown,
  options: { allowZero: boolean; label: string },
) {
  if (typeof value !== "string") {
    throw new MusicPricingValidationError("INVALID_AMOUNT", `${options.label} est invalide.`);
  }

  const normalized = value.trim();
  const match = /^(0|[1-9]\d{0,4})(?:[,.](\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new MusicPricingValidationError("INVALID_AMOUNT", `${options.label} est invalide.`);
  }

  const euros = Number(match[1]);
  const decimalDigits = match[2] ?? "";
  const cents = euros * 100 + Number(decimalDigits.padEnd(2, "0"));

  if (!Number.isSafeInteger(cents)) {
    throw new MusicPricingValidationError("INVALID_AMOUNT", `${options.label} est invalide.`);
  }
  if ((!options.allowZero && cents === 0) || cents > MAX_COMPONENT_PRICE_CENTS) {
    throw new MusicPricingValidationError("AMOUNT_OUT_OF_RANGE", `${options.label} est hors limites.`);
  }

  return cents;
}

export function validateMusicPricingDraft(input: MusicPricingDraftInput): ValidatedMusicPricingDraft {
  if (input.currency !== MUSIC_PRICING_CURRENCY) {
    throw new MusicPricingValidationError("UNSUPPORTED_CURRENCY", "La devise doit être EUR.");
  }

  return {
    currency: MUSIC_PRICING_CURRENCY,
    basePriceCents: parseEuroAmountToCents(input.basePrice, {
      allowZero: false,
      label: "Le prix de la création musicale",
    }),
    coverPriceCents: parseEuroAmountToCents(input.coverPrice, {
      allowZero: true,
      label: "Le prix de l’illustration",
    }),
    priorityPriceCents: parseEuroAmountToCents(input.priorityPrice, {
      allowZero: true,
      label: "Le prix du traitement prioritaire",
    }),
  };
}

export function parseExpectedMusicPricingRevision(value: unknown) {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^[1-9]\d{0,8}$/.test(normalized)) {
    throw new MusicPricingValidationError("INVALID_REVISION", "La révision tarifaire est invalide.");
  }
  const revision = Number(normalized);
  if (!Number.isSafeInteger(revision)) {
    throw new MusicPricingValidationError("INVALID_REVISION", "La révision tarifaire est invalide.");
  }
  return revision;
}

export function nextMusicPricingVersionLabel(currentVersion: string, nextRevision: number) {
  const match = /^(.*-v)(\d+)$/.exec(currentVersion);
  if (match) {
    const currentSequence = Number(match[2]);
    if (Number.isSafeInteger(currentSequence) && currentSequence < 999_999) {
      return `${match[1]}${currentSequence + 1}`;
    }
  }
  return `music-pricing-r${nextRevision}`;
}

export function formatEuroCents(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MusicPricingValidationError("INVALID_AMOUNT", "Le montant stocké est invalide.");
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: MUSIC_PRICING_CURRENCY }).format(cents / 100);
}

export function centsToAdminInput(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MusicPricingValidationError("INVALID_AMOUNT", "Le montant stocké est invalide.");
  }
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

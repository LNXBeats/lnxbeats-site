import {
  commercialRightsOffer,
  orderOffer,
  type CommercialLicenseStatus,
} from "@/data/order-offer";

export const orderTextLimits = {
  title: 120,
  recipient: 200,
  occasion: 200,
  briefMin: 30,
  brief: 10_000,
  musicalDirection: 500,
  emotion: 500,
  importantDetails: 4_000,
  wordsToInclude: 2_000,
  avoid: 2_000,
  pronunciationNotes: 1_000,
} as const;

export type OrderDraftInput = {
  title: string;
  recipient: string;
  occasion: string;
  brief: string;
  musicalDirection: string;
  emotion: string;
  importantDetails: string;
  wordsToInclude: string;
  avoid: string;
  pronunciationNotes: string;
  coverIncluded: boolean;
  priorityProcessing: boolean;
};

export type OrderActor = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER" | "CUSTOMER";
  status: "ACTIVE";
  emailVerified: true;
};

export type PricingSnapshot = {
  usage: "PERSONAL";
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: "EUR";
  pricingVersion: string;
  contractRequired: boolean;
};

type ParseResult =
  | { ok: true; value: OrderDraftInput }
  | { ok: false; message: string; field?: keyof OrderDraftInput };

function stringField(
  payload: Record<string, unknown>,
  field: keyof OrderDraftInput,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string; field: keyof OrderDraftInput } {
  const raw = payload[field];
  if (raw !== undefined && typeof raw !== "string") {
    return { ok: false, message: "Le format du brief est invalide.", field };
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length > maxLength) {
    return { ok: false, message: `Ce champ dépasse la limite de ${maxLength.toLocaleString("fr-FR")} caractères.`, field };
  }
  return { ok: true, value };
}

export function parseOrderDraftInput(value: unknown): ParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Le brief transmis est invalide." };
  }

  const payload = value as Record<string, unknown>;
  const fields = [
    ["title", orderTextLimits.title],
    ["recipient", orderTextLimits.recipient],
    ["occasion", orderTextLimits.occasion],
    ["brief", orderTextLimits.brief],
    ["musicalDirection", orderTextLimits.musicalDirection],
    ["emotion", orderTextLimits.emotion],
    ["importantDetails", orderTextLimits.importantDetails],
    ["wordsToInclude", orderTextLimits.wordsToInclude],
    ["avoid", orderTextLimits.avoid],
    ["pronunciationNotes", orderTextLimits.pronunciationNotes],
  ] as const;

  const strings = {} as Record<(typeof fields)[number][0], string>;
  for (const [field, maxLength] of fields) {
    const parsed = stringField(payload, field, maxLength);
    if (!parsed.ok) return parsed;
    strings[field] = parsed.value;
  }

  if (payload.coverIncluded !== undefined && typeof payload.coverIncluded !== "boolean") {
    return { ok: false, message: "L’option cover est invalide.", field: "coverIncluded" };
  }
  if (payload.priorityProcessing !== undefined && typeof payload.priorityProcessing !== "boolean") {
    return { ok: false, message: "L’option prioritaire est invalide.", field: "priorityProcessing" };
  }

  return {
    ok: true,
    value: {
      ...strings,
      coverIncluded: payload.coverIncluded === true,
      priorityProcessing: payload.priorityProcessing === true,
    },
  };
}

export function validateOrderForSubmission(input: OrderDraftInput) {
  if (!input.recipient) return { ok: false as const, message: "Indiquez à qui ou à quoi cette histoire est destinée.", field: "recipient" as const };
  if (input.brief.length < orderTextLimits.briefMin) {
    return { ok: false as const, message: `L’histoire doit contenir au moins ${orderTextLimits.briefMin} caractères.`, field: "brief" as const };
  }
  if (!input.musicalDirection) {
    return { ok: false as const, message: "Choisissez une direction musicale ou confiez ce choix à LNX Beats.", field: "musicalDirection" as const };
  }
  return { ok: true as const };
}

export function calculateOrderPrice(selection: {
  coverIncluded: boolean;
  priorityProcessing: boolean;
}): PricingSnapshot {
  const basePriceCents = orderOffer.personalBaseCents;
  const coverPriceCents = selection.coverIncluded ? orderOffer.coverCents : 0;
  const priorityPriceCents = selection.priorityProcessing ? orderOffer.priorityCents : 0;

  return {
    usage: "PERSONAL",
    basePriceCents,
    coverPriceCents,
    priorityPriceCents,
    totalCents: basePriceCents + coverPriceCents + priorityPriceCents,
    currency: orderOffer.currency,
    pricingVersion: orderOffer.pricingVersion,
    contractRequired: false,
  };
}

export function commercialLicensePricingSnapshot() {
  return { ...commercialRightsOffer };
}

const openCommercialLicenseStatuses = new Set<CommercialLicenseStatus>([
  "REQUESTED",
  "CONTRACT_PENDING",
  "PAYMENT_PENDING",
  "ACTIVE",
]);

export function canRequestCommercialLicense(
  orderStatus: string,
  existingStatuses: CommercialLicenseStatus[],
) {
  return orderStatus === "DELIVERED"
    && !existingStatuses.some((status) => openCommercialLicenseStatuses.has(status));
}

export function canAccessOrder(actor: Pick<OrderActor, "id" | "role">, ownerUserId: string | null) {
  return actor.role === "ADMIN" || (ownerUserId !== null && actor.id === ownerUserId);
}

export function canUseIncludedRevision(revisionAllowance: number, revisionUsed: number) {
  return revisionAllowance > 0 && revisionUsed >= 0 && revisionUsed < revisionAllowance;
}

export function formatOrderNumber(sequence: bigint | number, date = new Date()) {
  const numericSequence = typeof sequence === "bigint" ? sequence : BigInt(sequence);
  if (numericSequence <= 0n) throw new RangeError("The order sequence must be positive.");
  return `LNX-${date.getUTCFullYear()}-${numericSequence.toString().padStart(6, "0")}`;
}

export function sanitizeOriginalFilename(value: string) {
  const basename = value.split(/[\\/]/).pop() ?? "image";
  const clean = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\.{2,}/g, ".")
    .trim();
  return (clean || "image").slice(0, 120);
}

export function assertPhotoCapacity(existingCount: number, incomingCount: number) {
  return existingCount >= 0
    && incomingCount > 0
    && existingCount + incomingCount <= orderOffer.maxPhotos;
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(cents / 100);
}

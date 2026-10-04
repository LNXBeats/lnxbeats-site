import "server-only";

import { parseEuroAmountToCents } from "@/lib/pricing/domain";

export const ADMIN_EXTERNAL_PRODUCT_FORM_FIELDS = [
  "title", "providerLabel", "externalUrl", "price", "currency", "position",
] as const;

export class ExternalProductAdminFormError extends Error {
  constructor(readonly code: "INVALID_FORM" | "CONFIRMATION_REQUIRED") {
    super(code === "CONFIRMATION_REQUIRED" ? "Confirmation requise." : "Formulaire externe invalide.");
    this.name = "ExternalProductAdminFormError";
  }
}

export function strictExternalProductFormData(formData: FormData, allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (seen.has(key) || typeof value !== "string") throw new ExternalProductAdminFormError("INVALID_FORM");
    seen.add(key);
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key)) throw new ExternalProductAdminFormError("INVALID_FORM");
    result[key] = value;
  }
  return result;
}

export function assertExternalProductConfirmation(value: unknown, expected: string) {
  if (value !== expected) throw new ExternalProductAdminFormError("CONFIRMATION_REQUIRED");
}

export function externalProductEditorPayload(input: Record<string, unknown>) {
  return {
    title: input.title,
    providerLabel: input.providerLabel,
    externalUrl: input.externalUrl,
    currency: input.currency,
    position: input.position,
    priceCents: typeof input.price === "string" && input.price.trim() === ""
      ? null
      : parseEuroAmountToCents(input.price, { allowZero: false, label: "Le prix indicatif", maximumCents: 10_000_000 }),
  };
}

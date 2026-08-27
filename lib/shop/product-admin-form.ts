import "server-only";

import { parseEuroAmountToCents } from "@/lib/pricing/domain";

export const ADMIN_PRODUCT_EDITOR_FORM_FIELDS = [
  "slug",
  "title",
  "description",
  "price",
  "currency",
  "trackInventory",
  "stock",
  "shippingRequired",
  "shippingPrice",
  "position",
] as const;

const PRODUCT_EDITOR_PASSTHROUGH_FIELDS = [
  "slug",
  "title",
  "description",
  "currency",
  "trackInventory",
  "stock",
  "shippingRequired",
  "position",
] as const;

const PRODUCT_PRICE_MAXIMUM_CENTS = 10_000_000;
const PRODUCT_SHIPPING_MAXIMUM_CENTS = 1_000_000;

export class ProductAdminFormError extends Error {
  constructor(readonly code: "INVALID_FORM" | "CONFIRMATION_REQUIRED") {
    super(code === "CONFIRMATION_REQUIRED" ? "Confirmation produit requise." : "Formulaire produit invalide.");
    this.name = "ProductAdminFormError";
  }
}

function isReactActionMetadata(key: string) {
  return key.startsWith("$ACTION_");
}

export function strictAdminProductFormData(formData: FormData, allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (seen.has(key) || typeof value !== "string") {
      throw new ProductAdminFormError("INVALID_FORM");
    }
    seen.add(key);
    if (isReactActionMetadata(key)) continue;
    if (!allowed.has(key)) {
      throw new ProductAdminFormError("INVALID_FORM");
    }
    result[key] = value;
  }

  return result;
}

export function assertAdminProductConfirmation(value: unknown, expected: string) {
  if (value !== expected) throw new ProductAdminFormError("CONFIRMATION_REQUIRED");
}

function optionalPriceToCents(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return null;
  return parseEuroAmountToCents(value, {
    allowZero: false,
    label: "Le prix",
    maximumCents: PRODUCT_PRICE_MAXIMUM_CENTS,
  });
}

export function adminProductEditorPayload(input: Record<string, unknown>) {
  const result = Object.fromEntries(
    PRODUCT_EDITOR_PASSTHROUGH_FIELDS
      .filter((field) => field in input)
      .map((field) => [field, input[field]]),
  );

  return {
    ...result,
    priceCents: optionalPriceToCents(input.price),
    shippingPriceCents: input.shippingRequired === "on"
      ? parseEuroAmountToCents(input.shippingPrice, {
        allowZero: true,
        label: "Les frais d’envoi",
        maximumCents: PRODUCT_SHIPPING_MAXIMUM_CENTS,
      })
      : 0,
  };
}

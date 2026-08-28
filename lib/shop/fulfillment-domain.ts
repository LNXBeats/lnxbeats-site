const SHOP_ORDER_NUMBER = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;

export const SHOP_FULFILLMENT_CONFIRMATIONS = {
  preparing: "CONFIRM_SHOP_PREPARATION",
  shipped: "CONFIRM_SHOP_SHIPMENT",
} as const;

export type ShopShipmentDetails = Readonly<{
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}>;

export class ShopFulfillmentInputError extends Error {
  constructor(message = "Le formulaire de préparation Boutique est invalide.") {
    super(message);
    this.name = "ShopFulfillmentInputError";
  }
}

function exactFormValues(formData: FormData, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const values = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) {
      if (typeof value !== "string") throw new ShopFulfillmentInputError();
      continue;
    }
    if (!allowedSet.has(key) || typeof value !== "string" || values.has(key)) {
      throw new ShopFulfillmentInputError();
    }
    values.set(key, value);
  }
  if (values.size !== allowed.length || allowed.some((key) => !values.has(key))) {
    throw new ShopFulfillmentInputError();
  }
  return values;
}

function orderNumber(value: string | undefined) {
  if (!value || !SHOP_ORDER_NUMBER.test(value)) throw new ShopFulfillmentInputError();
  return value;
}

function optionalText(value: string | undefined, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ShopFulfillmentInputError();
  }
  return normalized;
}

function optionalHttpsUrl(value: string | undefined) {
  const normalized = optionalText(value, 500);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ShopFulfillmentInputError("L’URL de suivi est invalide.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ShopFulfillmentInputError("L’URL de suivi doit utiliser HTTPS.");
  }
  return url.toString();
}

export function parseShopPreparingForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "confirmation"]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.preparing) {
    throw new ShopFulfillmentInputError("La confirmation de préparation est requise.");
  }
  return Object.freeze({ orderNumber: orderNumber(values.get("orderNumber")) });
}

export function parseShopShippedForm(formData: FormData) {
  const values = exactFormValues(formData, [
    "orderNumber",
    "confirmation",
    "carrier",
    "trackingNumber",
    "trackingUrl",
  ]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.shipped) {
    throw new ShopFulfillmentInputError("La confirmation d’expédition est requise.");
  }
  return Object.freeze({
    orderNumber: orderNumber(values.get("orderNumber")),
    shipment: Object.freeze({
      carrier: optionalText(values.get("carrier"), 120),
      trackingNumber: optionalText(values.get("trackingNumber"), 160),
      trackingUrl: optionalHttpsUrl(values.get("trackingUrl")),
    }),
  });
}

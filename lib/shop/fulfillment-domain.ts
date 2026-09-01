const SHOP_ORDER_NUMBER = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;

export const SHOP_FULFILLMENT_CONFIRMATIONS = {
  preparing: "CONFIRM_SHOP_PREPARATION",
  ready: "CONFIRM_SHOP_READY_TO_SHIP",
  tracking: "CONFIRM_SHOP_TRACKING",
  shipped: "CONFIRM_SHOP_SHIPMENT",
} as const;

export type ShopTrackingDetails = Readonly<{
  carrier: string;
  trackingNumber: string;
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

function requiredText(value: string | undefined, maximum: number, message: string) {
  const normalized = optionalText(value, maximum);
  if (!normalized) throw new ShopFulfillmentInputError(message);
  return normalized;
}

function carrier(value: string | undefined) {
  const normalized = requiredText(value, 120, "Le transporteur ou mode d’expédition est requis.");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'’&()+/_-]*$/u.test(normalized)) {
    throw new ShopFulfillmentInputError("Le libellé du transporteur est invalide.");
  }
  return normalized;
}

function trackingNumber(value: string | undefined) {
  const normalized = requiredText(value, 40, "Le numéro de suivi est requis.").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._+/-]{5,39}$/.test(normalized)) {
    throw new ShopFulfillmentInputError("Le numéro de suivi contient des caractères invalides.");
  }
  return normalized;
}

function optionalHttpsUrl(value: string | undefined) {
  const normalized = optionalText(value, 1000);
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
  if (url.hostname.toLowerCase() !== "www.laposte.fr") {
    throw new ShopFulfillmentInputError("Le lien de suivi n’appartient pas au domaine public La Poste autorisé.");
  }
  const serialized = url.toString();
  if (serialized.length > 1000) throw new ShopFulfillmentInputError("L’URL de suivi est trop longue.");
  return serialized;
}

export function parseShopPreparingForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "confirmation"]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.preparing) {
    throw new ShopFulfillmentInputError("La confirmation de préparation est requise.");
  }
  return Object.freeze({ orderNumber: orderNumber(values.get("orderNumber")) });
}

export function parseShopReadyForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "confirmation"]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.ready) {
    throw new ShopFulfillmentInputError("La confirmation de fin de préparation est requise.");
  }
  return Object.freeze({ orderNumber: orderNumber(values.get("orderNumber")) });
}

export function parseShopTrackingForm(formData: FormData) {
  const values = exactFormValues(formData, [
    "orderNumber",
    "confirmation",
    "carrier",
    "trackingNumber",
    "trackingUrl",
  ]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.tracking) {
    throw new ShopFulfillmentInputError("La confirmation du suivi manuel est requise.");
  }
  return Object.freeze({
    orderNumber: orderNumber(values.get("orderNumber")),
    tracking: Object.freeze({
      carrier: carrier(values.get("carrier")),
      trackingNumber: trackingNumber(values.get("trackingNumber")),
      trackingUrl: optionalHttpsUrl(values.get("trackingUrl")),
    }),
  });
}

export function parseShopShippedForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "confirmation"]);
  if (values.get("confirmation") !== SHOP_FULFILLMENT_CONFIRMATIONS.shipped) {
    throw new ShopFulfillmentInputError("La confirmation d’expédition est requise.");
  }
  return Object.freeze({ orderNumber: orderNumber(values.get("orderNumber")) });
}

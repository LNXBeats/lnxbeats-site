import { createHash } from "node:crypto";
import {
  isMetropolitanFranceDestination,
  normalizeMetropolitanFrancePostalCode,
} from "@/lib/shop/metropolitan-france";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_ORDER_NUMBER_PATTERN = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;
const MAX_CART_LINES = 20;
const MAX_LINE_QUANTITY = 20;
const MAX_MONEY_CENTS = 100_000_000;

export type ShopCartLineIntent = Readonly<{
  productId: string;
  quantity: number;
  observedLockVersion: number;
}>;

export type ShopShippingAddress = Readonly<{
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
}>;

export type ShopOrderIntent = Readonly<{
  items: readonly ShopCartLineIntent[];
  shippingAddress: ShopShippingAddress | null;
  shippingQuoteVersion: string | null;
}>;

export type ShopShippingQuoteIntent = Readonly<{
  items: readonly ShopCartLineIntent[];
}>;

export class ShopDomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PAYLOAD"
      | "INVALID_QUANTITY"
      | "INVALID_IDEMPOTENCY_KEY"
      | "SHIPPING_ADDRESS_REQUIRED"
      | "SHIPPING_COUNTRY_UNAVAILABLE"
      | "MONEY_OVERFLOW",
    readonly status = 422,
  ) {
    super(message);
    this.name = "ShopDomainError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new ShopDomainError("La demande Boutique contient un champ inattendu.", "INVALID_PAYLOAD");
  }
}

function boundedText(value: unknown, label: string, maximum: number, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") {
    throw new ShopDomainError(`${label} est requis.`, "INVALID_PAYLOAD");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ShopDomainError(`${label} est invalide.`, "INVALID_PAYLOAD");
  }
  return normalized;
}

function parseShippingAddress(value: unknown): ShopShippingAddress | null {
  if (value === undefined || value === null) return null;
  if (!record(value)) {
    throw new ShopDomainError("L’adresse de livraison est invalide.", "INVALID_PAYLOAD");
  }
  assertExactKeys(value, [
    "firstName",
    "lastName",
    "addressLine1",
    "addressLine2",
    "postalCode",
    "city",
    "countryCode",
  ]);
  const countryCode = boundedText(value.countryCode, "Le pays", 2);
  if (!countryCode || !COUNTRY_CODE_PATTERN.test(countryCode)) {
    throw new ShopDomainError("Le code pays est invalide.", "INVALID_PAYLOAD");
  }
  return Object.freeze({
    firstName: boundedText(value.firstName, "Le prénom", 100)!,
    lastName: boundedText(value.lastName, "Le nom", 100)!,
    addressLine1: boundedText(value.addressLine1, "L’adresse", 240)!,
    addressLine2: boundedText(value.addressLine2, "Le complément d’adresse", 240, true),
    postalCode: boundedText(value.postalCode, "Le code postal", 32)!,
    city: boundedText(value.city, "La ville", 120)!,
    countryCode,
  });
}

function parseQuantity(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_LINE_QUANTITY) {
    throw new ShopDomainError(
      `La quantité doit être comprise entre 1 et ${MAX_LINE_QUANTITY}.`,
      "INVALID_QUANTITY",
    );
  }
  return Number(value);
}

function parseObservedLockVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new ShopDomainError("La version du produit est invalide.", "INVALID_PAYLOAD");
  }
  return Number(value);
}

export function parseShopOrderIntent(value: unknown): ShopOrderIntent {
  if (!record(value)) throw new ShopDomainError("Le panier transmis est invalide.", "INVALID_PAYLOAD");
  assertExactKeys(value, ["items", "shippingAddress", "shippingQuoteVersion"]);
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_CART_LINES) {
    throw new ShopDomainError("Le panier doit contenir entre 1 et 20 produits.", "INVALID_PAYLOAD");
  }

  const lines = new Map<string, { quantity: number; observedLockVersion: number }>();
  for (const item of value.items) {
    if (!record(item)) throw new ShopDomainError("Une ligne du panier est invalide.", "INVALID_PAYLOAD");
    assertExactKeys(item, ["productId", "quantity", "observedLockVersion"]);
    if (typeof item.productId !== "string" || !UUID_PATTERN.test(item.productId)) {
      throw new ShopDomainError("Un produit du panier est invalide.", "INVALID_PAYLOAD");
    }
    const quantity = parseQuantity(item.quantity);
    const observedLockVersion = parseObservedLockVersion(item.observedLockVersion);
    const current = lines.get(item.productId);
    if (current && current.observedLockVersion !== observedLockVersion) {
      throw new ShopDomainError("La version du produit est incohérente.", "INVALID_PAYLOAD");
    }
    const combined = (current?.quantity ?? 0) + quantity;
    if (combined > MAX_LINE_QUANTITY) {
      throw new ShopDomainError(
        `La quantité doit être comprise entre 1 et ${MAX_LINE_QUANTITY}.`,
        "INVALID_QUANTITY",
      );
    }
    lines.set(item.productId, { quantity: combined, observedLockVersion });
  }

  return Object.freeze({
    items: Object.freeze(
      [...lines.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([productId, line]) => Object.freeze({ productId, ...line })),
    ),
    shippingAddress: parseShippingAddress(value.shippingAddress),
    shippingQuoteVersion: value.shippingQuoteVersion === undefined || value.shippingQuoteVersion === null
      ? null
      : boundedText(value.shippingQuoteVersion, "La version du devis", 64),
  });
}

export function parseShopShippingQuoteIntent(value: unknown): ShopShippingQuoteIntent {
  if (!record(value)) throw new ShopDomainError("Le panier transmis est invalide.", "INVALID_PAYLOAD");
  assertExactKeys(value, ["items"]);
  const intent = parseShopOrderIntent({
    items: value.items,
    shippingAddress: null,
    shippingQuoteVersion: null,
  });
  return Object.freeze({ items: intent.items });
}

export function parseShopIdempotencyKey(value: string | null) {
  if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ShopDomainError(
      "La clé de création de commande est invalide.",
      "INVALID_IDEMPOTENCY_KEY",
      400,
    );
  }
  return value.toLowerCase();
}

export function parseShopOrderNumber(value: unknown) {
  if (typeof value !== "string" || !SHOP_ORDER_NUMBER_PATTERN.test(value)) {
    throw new ShopDomainError("Le numéro de commande Boutique est invalide.", "INVALID_PAYLOAD", 400);
  }
  return value;
}

export function shopOrderIntentFingerprint(intent: ShopOrderIntent) {
  const canonical = JSON.stringify({
    items: intent.items.map(({ productId, quantity, observedLockVersion }) => ({
      productId,
      quantity,
      observedLockVersion,
    })),
    shippingAddress: intent.shippingAddress,
    shippingQuoteVersion: intent.shippingQuoteVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseShopOrderCancellationFormData(formData: FormData) {
  const allowed = new Set(["orderNumber", "confirmation"]);
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key)) {
      throw new ShopDomainError("Le formulaire d’annulation est invalide.", "INVALID_PAYLOAD");
    }
    seen.add(key);
    if (key.startsWith("$ACTION_")) {
      if (typeof value !== "string") {
        throw new ShopDomainError("Le formulaire d’annulation est invalide.", "INVALID_PAYLOAD");
      }
      continue;
    }
    if (!allowed.has(key) || typeof value !== "string" || values.has(key)) {
      throw new ShopDomainError("Le formulaire d’annulation est invalide.", "INVALID_PAYLOAD");
    }
    values.set(key, value);
  }
  if (values.size !== allowed.size) {
    throw new ShopDomainError("Le formulaire d’annulation est incomplet.", "INVALID_PAYLOAD");
  }
  return Object.freeze({
    orderNumber: values.get("orderNumber")!,
    confirmation: values.get("confirmation")!,
  });
}

export function assertShippingAddress(
  address: ShopShippingAddress | null,
  allowedCountries: readonly string[],
) {
  if (!address) {
    throw new ShopDomainError("Renseignez une adresse de livraison.", "SHIPPING_ADDRESS_REQUIRED");
  }
  if (!allowedCountries.includes(address.countryCode)) {
    throw new ShopDomainError(
      "La livraison n’est pas disponible dans ce pays.",
      "SHIPPING_COUNTRY_UNAVAILABLE",
    );
  }
  const postalCode = normalizeMetropolitanFrancePostalCode(address.postalCode);
  if (!isMetropolitanFranceDestination(address.countryCode, postalCode)) {
    throw new ShopDomainError(
      "La livraison est disponible uniquement en France métropolitaine.",
      "SHIPPING_COUNTRY_UNAVAILABLE",
    );
  }
  return Object.freeze({ ...address, postalCode });
}

export function checkedMoney(...values: number[]) {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_CENTS)) {
    throw new ShopDomainError("Le montant calculé est invalide.", "MONEY_OVERFLOW");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > MAX_MONEY_CENTS) {
    throw new ShopDomainError("Le montant calculé est trop élevé.", "MONEY_OVERFLOW");
  }
  return total;
}

export function getAvailableProductQuantity(input: {
  trackInventory: boolean;
  stock: number | null;
  activeReserved: number;
}) {
  if (!input.trackInventory) return null;
  if (!Number.isSafeInteger(input.stock) || (input.stock ?? -1) < 0) return 0;
  if (!Number.isSafeInteger(input.activeReserved) || input.activeReserved < 0) return 0;
  return Math.max(0, (input.stock ?? 0) - input.activeReserved);
}

export type ShopPublicAvailabilityState = "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT";

export function getPublicAvailabilityState(input: {
  trackInventory: boolean;
  stock: number | null;
  activeReserved: number;
}): ShopPublicAvailabilityState {
  if (!input.trackInventory) return "AVAILABLE";
  const stock = Number.isSafeInteger(input.stock) && Number(input.stock) >= 0 ? Number(input.stock) : 0;
  if (stock === 0) return "SOLD_OUT";
  return getAvailableProductQuantity(input) === 0 ? "TEMPORARILY_UNAVAILABLE" : "AVAILABLE";
}

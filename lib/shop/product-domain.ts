const PRODUCT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PRODUCT_ACTION_CONFIRMATIONS = {
  publish: "CONFIRM_PRODUCT_PUBLICATION",
  unpublish: "CONFIRM_PRODUCT_UNPUBLICATION",
  archive: "CONFIRM_PRODUCT_ARCHIVAL",
  stock: "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
} as const;

const CREATE_UPDATE_FIELDS = new Set([
  "slug",
  "title",
  "description",
  "priceCents",
  "currency",
  "trackInventory",
  "stock",
  "shippingRequired",
  "shippingPriceCents",
  "position",
]);

export type ProductEditorInput = {
  slug: string;
  title: string;
  description: string;
  priceCents: number | null;
  currency: "EUR";
  trackInventory: boolean;
  stock: number | null;
  shippingRequired: boolean;
  shippingPriceCents: number;
  position: number;
};

export type ProductPublishState = {
  title: string;
  description: string;
  priceCents: number | null;
  currency: string;
  trackInventory: boolean;
  stock: number | null;
  shippingRequired: boolean;
  shippingPriceCents: number;
  assetCount: number;
};

export type ProductPublicationAsset = {
  visibility: string;
  type: string;
  mimeType: string;
  alt: string | null;
  rightsStatus: string;
};

export class ProductValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ProductValidationError";
  }
}

export function normalizeProductSlug(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160)
    .replace(/-$/g, "");
}

export function parseProductSlug(value: unknown) {
  const slug = normalizeProductSlug(value);
  if (!slug || slug === "nouveau" || !PRODUCT_SLUG_PATTERN.test(slug)) {
    throw new ProductValidationError("Le slug produit est invalide.", "INVALID_SLUG");
  }
  return slug;
}

function assertClosedPayload(input: Record<string, unknown>, allowed: ReadonlySet<string>) {
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new ProductValidationError("Le formulaire produit contient un champ inattendu.", "UNEXPECTED_FIELD");
  }
}

function text(value: unknown, label: string, maximum: number, minimum = 1) {
  if (typeof value !== "string") throw new ProductValidationError(`${label} est requis.`, "INVALID_TEXT");
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ProductValidationError(`${label} doit contenir entre ${minimum} et ${maximum} caractères.`, "INVALID_TEXT");
  }
  return normalized;
}

function booleanValue(value: unknown, label: string) {
  if (value === undefined || value === false) return false;
  if (value === true || value === "on") return true;
  throw new ProductValidationError(`${label} est invalide.`, "INVALID_BOOLEAN");
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number, nullable: true): number | null;
function integerValue(value: unknown, label: string, minimum: number, maximum: number, nullable?: false): number;
function integerValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  nullable = false,
) {
  if (nullable && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ProductValidationError(`${label} doit être un nombre entier.`, "INVALID_INTEGER");
  }
  const serialized = String(value);
  if (!/^-?\d+$/.test(serialized)) {
    throw new ProductValidationError(`${label} doit être un nombre entier.`, "INVALID_INTEGER");
  }
  const parsed = Number(serialized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ProductValidationError(`${label} est hors limites.`, "INVALID_INTEGER");
  }
  return parsed;
}

export function parseProductEditorInput(input: Record<string, unknown>): ProductEditorInput {
  assertClosedPayload(input, CREATE_UPDATE_FIELDS);
  const trackInventory = booleanValue(input.trackInventory, "Le suivi de stock");
  const shippingRequired = booleanValue(input.shippingRequired, "L’expédition");
  const priceCents = integerValue(input.priceCents, "Le prix", 1, 10_000_000, true);
  const stock = trackInventory
    ? integerValue(input.stock, "Le stock", 0, 1_000_000)
    : null;
  const shippingPriceCents = shippingRequired
    ? integerValue(input.shippingPriceCents, "Les frais d’envoi", 0, 1_000_000)
    : 0;
  if ((input.currency ?? "EUR") !== "EUR") {
    throw new ProductValidationError("Seule la devise EUR est autorisée pour cette fondation.", "INVALID_CURRENCY");
  }
  return {
    slug: parseProductSlug(input.slug),
    title: text(input.title, "Le titre", 240),
    description: text(input.description, "La description", 10_000),
    priceCents,
    currency: "EUR",
    trackInventory,
    stock,
    shippingRequired,
    shippingPriceCents,
    position: integerValue(input.position ?? "0", "La position", 0, 1_000_000),
  };
}

export function parseProductIdentity(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ProductValidationError("Le produit est invalide.", "INVALID_PRODUCT_ID");
  }
  return value;
}

export function parseProductLockVersion(value: unknown) {
  return integerValue(value, "La version du produit", 1, 2_147_483_647);
}

export function parseStockAdjustmentInput(input: Record<string, unknown>) {
  const allowed = new Set(["delta", "reason"]);
  assertClosedPayload(input, allowed);
  const delta = integerValue(input.delta, "L’ajustement de stock", -1_000_000, 1_000_000);
  if (delta === 0) throw new ProductValidationError("L’ajustement de stock ne peut pas être nul.", "ZERO_ADJUSTMENT");
  return {
    delta,
    reason: text(input.reason, "Le motif", 500, 3),
  };
}

export function isPublishableProductImage(asset: ProductPublicationAsset) {
  return asset.visibility === "PUBLIC"
    && (asset.type === "IMAGE" || asset.type === "COVER")
    && asset.mimeType.startsWith("image/")
    && Boolean(asset.alt?.trim())
    && asset.rightsStatus === "CLEARED";
}

export function countPublishableProductImages(assets: readonly ProductPublicationAsset[]) {
  return assets.filter(isPublishableProductImage).length;
}

export function getProductPublicationBlockers(product: ProductPublishState) {
  const blockers: string[] = [];
  if (!product.title.trim()) blockers.push("TITLE_MISSING");
  if (!product.description.trim()) blockers.push("DESCRIPTION_MISSING");
  if (!Number.isInteger(product.priceCents) || (product.priceCents ?? 0) <= 0) blockers.push("PRICE_INVALID");
  if (product.currency !== "EUR") blockers.push("CURRENCY_INVALID");
  if (product.trackInventory && (!Number.isInteger(product.stock) || (product.stock ?? -1) < 0)) blockers.push("STOCK_INVALID");
  if (!product.shippingRequired && product.shippingPriceCents !== 0) blockers.push("SHIPPING_INCOHERENT");
  if (product.shippingRequired && (!Number.isInteger(product.shippingPriceCents) || product.shippingPriceCents < 0)) blockers.push("SHIPPING_INVALID");
  if (product.assetCount < 1) blockers.push("IMAGE_MISSING");
  return blockers;
}

export function assertProductPublishable(product: ProductPublishState) {
  const blockers = getProductPublicationBlockers(product);
  if (blockers.length) {
    throw new ProductValidationError(
      "Ce produit ne peut pas être publié tant que sa fiche, son prix et son image ne sont pas complets.",
      `PUBLICATION_BLOCKED:${blockers.join(",")}`,
    );
  }
}

export function formatProductPrice(priceCents: number | null, currency = "EUR") {
  if (priceCents === null) return "À définir";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(priceCents / 100);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISTROKID_HOST = "direct.distrokid.com";

export const EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS = {
  publish: "CONFIRM_EXTERNAL_PRODUCT_PUBLICATION",
  unpublish: "CONFIRM_EXTERNAL_PRODUCT_UNPUBLICATION",
  archive: "CONFIRM_EXTERNAL_PRODUCT_ARCHIVAL",
} as const;

export class ExternalProductValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ExternalProductValidationError";
  }
}

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new ExternalProductValidationError(`${label} est requis.`, "INVALID_TEXT");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ExternalProductValidationError(`${label} doit contenir entre 1 et ${maximum} caractères.`, "INVALID_TEXT");
  }
  return normalized;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new ExternalProductValidationError(`${label} doit être un nombre entier.`, "INVALID_INTEGER");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ExternalProductValidationError(`${label} est hors limites.`, "INVALID_INTEGER");
  }
  return parsed;
}

export function parseExternalProductIdentity(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ExternalProductValidationError("Produit externe invalide.", "INVALID_ID");
  }
  return value;
}

export function parseExternalProductLockVersion(value: unknown) {
  return integer(value, "La version", 1, 2_147_483_647);
}

export function parseDistroKidProductUrl(value: unknown) {
  const raw = text(value, "L’URL DistroKid", 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExternalProductValidationError("L’URL DistroKid est invalide.", "INVALID_URL");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== DISTROKID_HOST
    || url.username
    || url.password
    || (url.port && url.port !== "443")
  ) {
    throw new ExternalProductValidationError("Seules les URL HTTPS direct.distrokid.com sont autorisées.", "INVALID_URL");
  }
  url.hash = "";
  return url.toString();
}

export function parseExternalProductEditorInput(input: Record<string, unknown>) {
  const allowed = new Set(["title", "providerLabel", "externalUrl", "priceCents", "currency", "position"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ExternalProductValidationError("Le formulaire contient un champ inattendu.", "UNEXPECTED_FIELD");
  }
  const priceCents = input.priceCents === null || input.priceCents === undefined || input.priceCents === ""
    ? null
    : integer(input.priceCents, "Le prix", 1, 10_000_000);
  if (input.currency !== "EUR") throw new ExternalProductValidationError("La devise doit être EUR.", "INVALID_CURRENCY");
  return {
    title: text(input.title, "Le titre", 240),
    provider: "DISTROKID" as const,
    providerLabel: text(input.providerLabel, "Le libellé externe", 80),
    externalUrl: parseDistroKidProductUrl(input.externalUrl),
    priceCents,
    currency: "EUR" as const,
    position: integer(input.position, "La position", 0, 1_000_000),
  };
}

export function externalProductPublicationBlockers(product: {
  title: string;
  externalUrl: string;
  image: null | { type: string; mimeType: string; visibility: string; rightsStatus: string; alt: string | null };
}) {
  const blockers: string[] = [];
  if (!product.title.trim()) blockers.push("TITLE_MISSING");
  try { parseDistroKidProductUrl(product.externalUrl); } catch { blockers.push("URL_INVALID"); }
  if (
    !product.image
    || product.image.type !== "IMAGE"
    || !product.image.mimeType.startsWith("image/")
    || product.image.visibility !== "PUBLIC"
    || product.image.rightsStatus !== "CLEARED"
    || !product.image.alt?.trim()
  ) blockers.push("IMAGE_MISSING");
  return blockers;
}

export function formatExternalProductPrice(priceCents: number | null, currency = "EUR") {
  return priceCents === null
    ? "Prix sur DistroKid"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(priceCents / 100);
}

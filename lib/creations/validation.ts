const CREATION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_CREATION_SLUGS = new Set(["nouveau"]);

export const CREATION_EDITOR_FORM_FIELDS = [
  "slug",
  "title",
  "summary",
  "description",
  "collaborator",
  "credits",
  "category",
  "primaryMedia",
  "position",
  "seoTitle",
  "seoDescription",
] as const;

export const CREATION_EXTERNAL_LINK_FORM_FIELDS = ["label", "url", "position"] as const;

export type CreationEditorInput = {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  collaborator: string | null;
  credits: string | null;
  category: string | null;
  primaryMedia: "COVER" | "AUDIO" | "VIDEO" | null;
  position: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type CreationExternalLinkInput = {
  label: string;
  url: string;
  position: number;
};

export class CreationValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "CreationValidationError";
  }
}

export class CreationAdminFormError extends Error {
  constructor(readonly code: "INVALID_FORM" | "CONFIRMATION_REQUIRED") {
    super(code === "CONFIRMATION_REQUIRED" ? "Confirmation requise." : "Formulaire Créations invalide.");
    this.name = "CreationAdminFormError";
  }
}

export function normalizeCreationSlug(value: unknown) {
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

export function parseCreationSlug(value: unknown) {
  const slug = normalizeCreationSlug(value);
  if (!slug || RESERVED_CREATION_SLUGS.has(slug) || !CREATION_SLUG_PATTERN.test(slug)) {
    throw new CreationValidationError("Le slug de la création est invalide.", "INVALID_SLUG");
  }
  return slug;
}

function assertClosedPayload(input: Record<string, unknown>, allowed: ReadonlySet<string>) {
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new CreationValidationError("La requête contient un champ inattendu.", "UNEXPECTED_FIELD");
  }
}

function requiredText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") {
    throw new CreationValidationError(`${label} est requis.`, "INVALID_TEXT");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new CreationValidationError(`${label} est invalide.`, "INVALID_TEXT");
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new CreationValidationError(`${label} est invalide.`, "INVALID_TEXT");
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new CreationValidationError(`${label} est trop long.`, "INVALID_TEXT");
  }
  return normalized;
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new CreationValidationError(`${label} doit être un entier.`, "INVALID_INTEGER");
  }
  const serialized = String(value);
  if (!/^\d+$/.test(serialized)) {
    throw new CreationValidationError(`${label} doit être un entier.`, "INVALID_INTEGER");
  }
  const parsed = Number(serialized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CreationValidationError(`${label} est hors limites.`, "INVALID_INTEGER");
  }
  return parsed;
}

function primaryMedia(value: unknown): CreationEditorInput["primaryMedia"] {
  if (value === undefined || value === null || value === "") return null;
  if (value === "COVER" || value === "AUDIO" || value === "VIDEO") return value;
  throw new CreationValidationError("Le média principal est invalide.", "INVALID_PRIMARY_MEDIA");
}

export function parseCreationEditorInput(input: Record<string, unknown>): CreationEditorInput {
  assertClosedPayload(input, new Set(CREATION_EDITOR_FORM_FIELDS));
  return {
    slug: parseCreationSlug(input.slug),
    title: requiredText(input.title, "Le titre", 240),
    summary: optionalText(input.summary, "Le résumé", 1000),
    description: optionalText(input.description, "La description", 50_000),
    collaborator: optionalText(input.collaborator, "Le collaborateur", 240),
    credits: optionalText(input.credits, "Les crédits", 20_000),
    category: optionalText(input.category, "La catégorie", 120),
    primaryMedia: primaryMedia(input.primaryMedia),
    position: integerValue(input.position ?? 0, "La position", 0, 1_000_000),
    seoTitle: optionalText(input.seoTitle, "Le titre SEO", 240),
    seoDescription: optionalText(input.seoDescription, "La description SEO", 1000),
  };
}

export function parseCreationExternalLinkInput(input: Record<string, unknown>): CreationExternalLinkInput {
  assertClosedPayload(input, new Set(CREATION_EXTERNAL_LINK_FORM_FIELDS));
  const serializedUrl = requiredText(input.url, "L’URL", 2048);
  let url: URL;
  try {
    url = new URL(serializedUrl);
  } catch {
    throw new CreationValidationError("L’URL externe est invalide.", "INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new CreationValidationError("Le lien externe doit utiliser HTTPS sans identifiants.", "INVALID_URL");
  }
  return {
    label: requiredText(input.label, "Le libellé", 180),
    url: url.toString(),
    position: integerValue(input.position ?? 0, "La position", 0, 1_000_000),
  };
}

export function parseCreationIdentity(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CreationValidationError("La création est invalide.", "INVALID_CREATION_ID");
  }
  return value;
}

export function parseCreationExternalLinkIdentity(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CreationValidationError("Le lien externe est invalide.", "INVALID_LINK_ID");
  }
  return value;
}

export function parseCreationLockVersion(value: unknown) {
  return integerValue(value, "La version de la création", 1, 2_147_483_647);
}

function isReactActionMetadata(key: string) {
  return key.startsWith("$ACTION_");
}

export function strictCreationFormData(formData: FormData, allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (seen.has(key) || typeof value !== "string") {
      throw new CreationAdminFormError("INVALID_FORM");
    }
    seen.add(key);
    if (isReactActionMetadata(key)) continue;
    if (!allowed.has(key)) throw new CreationAdminFormError("INVALID_FORM");
    result[key] = value;
  }
  return result;
}

export function assertCreationConfirmation(value: unknown, expected: string) {
  if (value !== expected) throw new CreationAdminFormError("CONFIRMATION_REQUIRED");
}

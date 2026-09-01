import "server-only";

import { createHash } from "node:crypto";
import { finalShopTermsCandidate } from "@/data/legal";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const SHOP_LEGAL_QA_TERMS_VERSION = "shop-cgv-phase3-qa-v1";
export const SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION = "shop-cgv-phase3-qa-v0";
export const SHOP_LEGAL_QA_CONFIRMATION = "enable-local-shop-legal-qa";
export const SHOP_LEGAL_RELEASE_B_CANDIDATE_VERSION = finalShopTermsCandidate.version;

const QA_ARCHIVED_TECHNICAL_FINGERPRINT_SOURCE =
  "lnx-studio:shop-terms:technical-qa-placeholder:shop-cgv-phase3-qa-v0";
const QA_TECHNICAL_FINGERPRINT_SOURCE =
  "lnx-studio:shop-terms:technical-qa-placeholder:shop-cgv-phase3-qa-v1";
export const SHOP_LEGAL_QA_TERMS_HASH = createHash("sha256").update(QA_TECHNICAL_FINGERPRINT_SOURCE).digest("hex");

type ShopTermsRegistryEntry = Readonly<{
  version: string;
  hashSha256: string;
  approval: "QA_ONLY" | "CANDIDATE" | "APPROVED";
}>;

const SHOP_TERMS_REGISTRY: Readonly<Record<string, ShopTermsRegistryEntry>> = Object.freeze({
  [SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION]: Object.freeze({
    version: SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION,
    hashSha256: createHash("sha256").update(QA_ARCHIVED_TECHNICAL_FINGERPRINT_SOURCE).digest("hex"),
    approval: "QA_ONLY",
  }),
  [SHOP_LEGAL_QA_TERMS_VERSION]: Object.freeze({
    version: SHOP_LEGAL_QA_TERMS_VERSION,
    hashSha256: SHOP_LEGAL_QA_TERMS_HASH,
    approval: "QA_ONLY",
  }),
  [SHOP_LEGAL_RELEASE_B_CANDIDATE_VERSION]: Object.freeze({
    version: SHOP_LEGAL_RELEASE_B_CANDIDATE_VERSION,
    hashSha256: finalShopTermsCandidate.hashSha256,
    approval: "CANDIDATE",
  }),
});

export type ShopTermsSnapshot = Readonly<{
  termsVersion: string;
  termsHashSha256: string;
  termsAcceptedAt: Date;
}>;

export type ShopLegalConfiguration = Readonly<{
  ready: boolean;
  activeTerms: ShopTermsRegistryEntry | null;
}>;

export type ShopLegalGateErrorCode =
  | "CONFIGURATION_INVALID"
  | "LEGAL_NOT_READY"
  | "TERMS_NOT_ACCEPTED";

export class ShopLegalGateError extends Error {
  constructor(
    message: string,
    readonly code: ShopLegalGateErrorCode,
  ) {
    super(message);
    this.name = "ShopLegalGateError";
  }
}

function invalid(message: string): never {
  throw new ShopLegalGateError(message, "CONFIGURATION_INVALID");
}

function exactBoolean(value: string | undefined, name: string) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return invalid(`${name} must be either true or false.`);
}

function assertQaOnlyEntryIsLocallyArmed(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.NODE_ENV === "production") {
    invalid("A QA-only Shop terms version is forbidden in a production runtime.");
  }
  if (environment.SHOP_LEGAL_QA_CONFIRM !== SHOP_LEGAL_QA_CONFIRMATION) {
    invalid(`SHOP_LEGAL_QA_CONFIRM must equal ${SHOP_LEGAL_QA_CONFIRMATION}.`);
  }

  const rawUrl = environment.AUTH_URL ?? environment.SITE_URL;
  if (!rawUrl) invalid("A loopback AUTH_URL or SITE_URL is required for Shop legal QA.");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalid("The Shop legal QA URL is invalid.");
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    invalid("QA-only Shop terms are restricted to an explicit loopback HTTP runtime.");
  }
}

export function parseShopLegalConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopLegalConfiguration {
  const ready = exactBoolean(environment.SHOP_LEGAL_READY, "SHOP_LEGAL_READY");
  if (!ready) return { ready: false, activeTerms: null };

  const version = environment.SHOP_TERMS_VERSION?.trim();
  if (!version) invalid("SHOP_TERMS_VERSION is required when SHOP_LEGAL_READY=true.");
  const activeTerms = SHOP_TERMS_REGISTRY[version];
  if (!activeTerms) invalid("SHOP_TERMS_VERSION does not identify a registered immutable version.");
  if (activeTerms.approval === "QA_ONLY") assertQaOnlyEntryIsLocallyArmed(environment);
  if (activeTerms.approval === "CANDIDATE") {
    throw new ShopLegalGateError("The selected Shop terms still require human approval.", "LEGAL_NOT_READY");
  }

  return { ready: true, activeTerms };
}

export function requireAcceptedShopTerms(
  accepted: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): ShopTermsSnapshot {
  if (accepted !== true) {
    throw new ShopLegalGateError(
      "Explicit acceptance of the active Shop terms is required.",
      "TERMS_NOT_ACCEPTED",
    );
  }
  const configuration = parseShopLegalConfiguration(environment);
  if (!configuration.ready || !configuration.activeTerms) {
    throw new ShopLegalGateError(
      "The Shop legal gate is not ready.",
      "LEGAL_NOT_READY",
    );
  }
  if (!Number.isFinite(now.getTime())) invalid("The Shop terms acceptance timestamp is invalid.");

  return Object.freeze({
    termsVersion: configuration.activeTerms.version,
    termsHashSha256: configuration.activeTerms.hashSha256,
    termsAcceptedAt: new Date(now.getTime()),
  });
}

export function requireAcceptedShopTermsForOrder(
  accepted: unknown,
  existing: Readonly<{
    termsVersion: string | null;
    termsHashSha256: string | null;
    termsAcceptedAt: Date | null;
  }>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): ShopTermsSnapshot {
  if (accepted !== true) {
    throw new ShopLegalGateError(
      "Explicit acceptance of the Shop terms is required.",
      "TERMS_NOT_ACCEPTED",
    );
  }
  const configuration = parseShopLegalConfiguration(environment);
  if (!configuration.ready || !configuration.activeTerms) {
    throw new ShopLegalGateError("The Shop legal gate is not ready.", "LEGAL_NOT_READY");
  }

  const present = [existing.termsVersion, existing.termsHashSha256, existing.termsAcceptedAt]
    .filter((value) => value !== null).length;
  if (present === 0) return requireAcceptedShopTerms(true, environment, now);
  if (present !== 3 || !existing.termsVersion || !existing.termsHashSha256 || !existing.termsAcceptedAt) {
    return invalid("The persisted Shop terms snapshot is incomplete.");
  }
  const registered = SHOP_TERMS_REGISTRY[existing.termsVersion];
  if (
    !registered
    || registered.hashSha256 !== existing.termsHashSha256
    || Number.isNaN(existing.termsAcceptedAt.getTime())
  ) return invalid("The persisted Shop terms snapshot is not registered.");
  if (registered.approval === "QA_ONLY") assertQaOnlyEntryIsLocallyArmed(environment);

  return Object.freeze({
    termsVersion: registered.version,
    termsHashSha256: registered.hashSha256,
    termsAcceptedAt: new Date(existing.termsAcceptedAt.getTime()),
  });
}

export function shopLegalHealthSummary(configuration: ShopLegalConfiguration) {
  return {
    ready: configuration.ready,
    activeVersionConfigured: configuration.activeTerms !== null,
    productionApproved: configuration.activeTerms?.approval === "APPROVED",
  } as const;
}

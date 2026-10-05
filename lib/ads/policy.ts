import { ADSENSE_SELLER_LINE } from "@/data/adsense";

export type AdSlot = "content" | "footer";
export type AdsEnvironment = Readonly<Record<string, string | undefined>>;
type Environment = AdsEnvironment;

// Release guard, not an environment override. The Google draft is not published.
// Google's supported nonce/strict-CSP integration and real CMP lifecycle still
// require a separate verified activation. Do not loosen the site's CSP silently.
export const GOOGLE_CMP_RUNTIME_VERIFIED = false;

// Explicit allowlist: unknown routes, subroutes and all transactional/private pages fail closed.
export function allowsAdSlot(pathname: string, slot: AdSlot) {
  if (slot === "footer") return pathname === "/" || pathname === "/boutique";
  return /^\/album\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname);
}

export function qaAdSlotEnabled(pathname: string, slot: AdSlot, env: Environment) {
  if (!allowsAdSlot(pathname, slot) || env.ADS_ENABLED === "true") return false;
  if (env.ADS_QA_PLACEHOLDERS !== "true") return false;
  if (!isQaAdsEnvironment(env)) return false;
  return env[slot === "content" ? "ADS_CONTENT_SLOT_ENABLED" : "ADS_FOOTER_SLOT_ENABLED"] === "true";
}

export function isQaAdsEnvironment(env: Environment) {
  if (env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === "production" || env.PAYMENT_DEPLOYMENT_ENV === "production") return false;
  // Explicit non-production deployment context required; missing context never enables QA.
  if (!["local", "staging"].includes(env.ADS_QA_ENVIRONMENT ?? "")) return false;
  try {
    const host = new URL(env.SITE_URL ?? "").hostname;
    return ["localhost", "127.0.0.1"].includes(host) || (env.ADS_QA_ENVIRONMENT === "staging" && host.endsWith(".up.railway.app") && host.includes("preview"));
  } catch { return false; }
}

export function googleCmpConfigured(env: Environment) {
  // Never bootstrap Google's advertising tag in Preview, including when a flag is wrong.
  return GOOGLE_CMP_RUNTIME_VERIFIED && env.RAILWAY_ENVIRONMENT_NAME === "production"
    && env.SITE_URL === "https://www.lnxbeats.fr"
    && env.ADS_QA_PLACEHOLDERS !== "true"
    && env.ADS_GOOGLE_CMP_ENABLED === "true"
    && env.ADS_GOOGLE_CMP_PUBLISHED === "true";
}

export function liveAdSlotId(slot: AdSlot, env: Environment) {
  const value = env[slot === "footer" ? "ADSENSE_FOOTER_SLOT_ID" : "ADSENSE_CONTENT_SLOT_ID"];
  return value && /^[0-9]{10}$/.test(value) ? value : null;
}

export function liveAdsEnabled(env: Environment = {}) {
  return googleCmpConfigured(env) && env.ADS_ENABLED === "true" && env.ADSENSE_SITE_APPROVED === "true";
}

export function validatedAdsTxt(env: Environment) {
  const line = env.ADSENSE_AUTHORIZED_SELLER_LINE?.trim() ?? ADSENSE_SELLER_LINE;
  // Do not silently switch the declared seller away from the verified account.
  if (line !== ADSENSE_SELLER_LINE) return null;
  return `${line}\n`;
}

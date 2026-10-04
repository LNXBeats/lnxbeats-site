export type AdSlot = "content" | "footer";
type Environment = Readonly<Record<string, string | undefined>>;

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

// Live loading intentionally unavailable until a real publisher, Google-certified CMP,
// consent lifecycle and human visual review are validated. A flag alone cannot bypass it.
export function liveAdsEnabled() { return false; }

export function validatedAdsTxt(env: Environment) {
  const line = env.ADSENSE_AUTHORIZED_SELLER_LINE?.trim();
  if (!line || !/^google\.com, pub-[0-9]{16}, DIRECT, f08c47fec0942fa0$/.test(line)) return null;
  return `${line}\n`;
}

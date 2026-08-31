export const CANONICAL_SITE_ORIGIN = "https://www.lnxbeats.fr" as const;
export const PRODUCTION_RAILWAY_PUBLIC_HOST = "lnxbeats-site-production.up.railway.app" as const;

const CANONICAL_SITE_HOST = new URL(CANONICAL_SITE_ORIGIN).hostname;
const LEGACY_PUBLIC_HOSTS = new Set(["lnxbeats.fr", PRODUCTION_RAILWAY_PUBLIC_HOST]);
const TECHNICAL_PATH_PREFIXES = ["/api", "/_next", "/media"] as const;

export type PublicOriginPolicy =
  | { action: "none" }
  | { action: "noindex" }
  | { action: "redirect"; location: string; status: 308 };

export function canonicalPublicUrl(pathname = "/", search = "") {
  const url = new URL(CANONICAL_SITE_ORIGIN);
  url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.search = search;
  return url.toString();
}

export function normalizeRequestHostname(rawHost: string | null | undefined) {
  if (!rawHost) return null;
  const candidate = rawHost.trim().toLowerCase();
  if (!candidate || candidate.includes(",") || /\s/.test(candidate)) return null;
  try {
    return new URL(`http://${candidate}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isTechnicalPublicPath(pathname: string) {
  return TECHNICAL_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function resolvePublicOriginPolicy(input: Readonly<{ method: string; host: string | null | undefined; pathname: string; search?: string }>): PublicOriginPolicy {
  const method = input.method.toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || isTechnicalPublicPath(input.pathname)) return { action: "none" };
  const hostname = normalizeRequestHostname(input.host);
  if (!hostname || hostname === CANONICAL_SITE_HOST) return { action: "none" };
  if (LEGACY_PUBLIC_HOSTS.has(hostname)) {
    return { action: "redirect", location: canonicalPublicUrl(input.pathname, input.search ?? ""), status: 308 };
  }
  if (hostname.endsWith(".up.railway.app")) return { action: "noindex" };
  return { action: "none" };
}

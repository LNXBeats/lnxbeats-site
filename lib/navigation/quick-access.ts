const QUICK_ACCESS_EXACT_PATHS = new Set([
  "/",
  "/discographie",
  "/boutique",
  "/a-propos",
  "/contact",
]);

function normalizedPathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isQuickAccessRoute(pathname: string) {
  const normalized = normalizedPathname(pathname);
  return QUICK_ACCESS_EXACT_PATHS.has(normalized) || /^\/album\/[^/]+$/.test(normalized);
}

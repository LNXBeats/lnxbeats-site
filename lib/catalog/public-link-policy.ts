type CatalogLinkIdentity = {
  platform: string;
  url: string;
};

const ETSY_HOSTS = ["etsy.com", "etsy.me"] as const;

function normalizedHostname(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function isEtsyCatalogUrl(rawUrl: string) {
  const hostname = normalizedHostname(rawUrl);
  return hostname !== null && ETSY_HOSTS.some((etsyHost) => hostname === etsyHost || hostname.endsWith(`.${etsyHost}`));
}

export function isEtsyCatalogLink(link: CatalogLinkIdentity) {
  return link.platform.toUpperCase() === "ETSY" || isEtsyCatalogUrl(link.url);
}

export function isPublicCatalogLink(link: CatalogLinkIdentity) {
  return normalizedHostname(link.url) !== null && !isEtsyCatalogLink(link);
}

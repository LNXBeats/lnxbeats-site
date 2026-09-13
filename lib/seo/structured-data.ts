import { siteConfig } from "@/data/site";
import type { PublicProject } from "@/lib/catalog/types";
import { canonicalPublicUrl } from "@/lib/seo/canonical";

export const LNX_ARTIST_ID = `${canonicalPublicUrl()}#artist`;
export const LNX_WEBSITE_ID = `${canonicalPublicUrl()}#website`;

export function serializeStructuredData(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildSiteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": LNX_WEBSITE_ID,
        url: canonicalPublicUrl(),
        name: siteConfig.name,
        alternateName: "LNX STUDIO",
        inLanguage: "fr-FR",
        author: { "@id": LNX_ARTIST_ID },
      },
      {
        "@type": "Person",
        "@id": LNX_ARTIST_ID,
        name: "Ludovic Mathon",
        alternateName: siteConfig.name,
        url: canonicalPublicUrl("/a-propos"),
        sameAs: [...siteConfig.platforms, ...siteConfig.social].map(({ url }) => url),
      },
    ],
  };
}

function breadcrumbs(items: readonly Readonly<{ name: string; pathname: string }>[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalPublicUrl(item.pathname),
    })),
  };
}

export function buildProjectStructuredData(project: PublicProject) {
  const pathname = `/album/${project.slug}`;
  const url = canonicalPublicUrl(pathname);
  const image = canonicalPublicUrl(project.cover ?? "/og.png");
  const releaseLinks = project.platforms
    .filter(({ scope }) => scope === "release" || scope === "store")
    .map(({ url: platformUrl }) => platformUrl);
  const common = {
    "@id": `${url}#project`,
    url,
    name: project.title,
    description: project.seo.description,
    image,
    inLanguage: "fr-FR",
    creator: { "@id": LNX_ARTIST_ID },
    ...(project.status === "published" && project.releaseDate ? { datePublished: project.releaseDate } : {}),
    ...(project.genres.length > 0 ? { genre: [...project.genres] } : {}),
    ...(releaseLinks.length > 0 ? { sameAs: releaseLinks } : {}),
  };
  const entity = project.type === "album"
    ? {
        "@type": "MusicAlbum",
        ...common,
        byArtist: { "@id": LNX_ARTIST_ID },
        ...(project.trackCount !== null ? { numTracks: project.trackCount } : {}),
        ...(project.tracks.length > 0 ? {
          track: project.tracks.map((track) => ({
            "@type": "MusicRecording",
            position: track.number,
            name: track.title,
            byArtist: { "@id": LNX_ARTIST_ID },
          })),
        } : {}),
      }
    : project.type === "single"
      ? { "@type": "MusicRecording", ...common, byArtist: { "@id": LNX_ARTIST_ID } }
      : { "@type": "CreativeWork", ...common, author: { "@id": LNX_ARTIST_ID } };

  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbs([
        { name: "Accueil", pathname: "/" },
        { name: "Discographie", pathname: "/discographie" },
        { name: project.title, pathname },
      ]),
      entity,
    ],
  };
}

type StructuredProduct = Readonly<{
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  availabilityState: "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT";
  image: Readonly<{ id: string; alt: string; width: number | null; height: number | null }> | null;
}>;

export function buildProductStructuredData(product: StructuredProduct) {
  const pathname = `/boutique/${product.slug}`;
  const url = canonicalPublicUrl(pathname);
  const availability = product.availabilityState === "AVAILABLE"
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbs([
        { name: "Accueil", pathname: "/" },
        { name: "Boutique", pathname: "/boutique" },
        { name: product.title, pathname },
      ]),
      {
        "@type": "Product",
        "@id": `${url}#product`,
        url,
        name: product.title,
        description: product.description,
        ...(product.image ? {
          image: canonicalPublicUrl(`/media/boutique/${product.image.id}`),
        } : {}),
        brand: { "@type": "Brand", name: siteConfig.name },
        offers: {
          "@type": "Offer",
          url,
          price: (product.priceCents / 100).toFixed(2),
          priceCurrency: product.currency,
          availability,
        },
      },
    ],
  };
}

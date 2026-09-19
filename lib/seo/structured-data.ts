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

function publicHttpUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) {
    return canonicalPublicUrl(candidate);
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function structuredDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type StructuredCreationVideo = Readonly<{
  published: boolean;
  url?: string | null;
  contentUrl?: string | null;
  thumbnailUrl?: string | null;
  name?: string | null;
  description?: string | null;
  uploadDate?: Date | string | null;
  duration?: string | null;
}>;

export type StructuredCreation = Readonly<{
  slug: string;
  title: string;
  description: string;
  image?: string | null;
  publishedAt?: Date | string | null;
  collaborator?: string | null;
  category?: string | null;
  video?: StructuredCreationVideo | null;
}>;

export function buildCreationStructuredData(creation: StructuredCreation) {
  const slug = creation.slug.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) {
    throw new TypeError("Invalid public creation slug.");
  }
  const pathname = `/creations/${slug}`;
  const url = canonicalPublicUrl(pathname);
  const image = publicHttpUrl(creation.image);
  const publishedAt = structuredDate(creation.publishedAt);
  const videoContentUrl = creation.video?.published
    ? publicHttpUrl(creation.video.contentUrl ?? creation.video.url)
    : null;
  const videoThumbnailUrl = creation.video?.published
    ? publicHttpUrl(creation.video.thumbnailUrl ?? creation.image)
    : null;
  const videoUploadDate = creation.video?.published
    ? structuredDate(creation.video.uploadDate ?? creation.publishedAt)
    : null;
  const hasStructuredVideo = Boolean(videoContentUrl && videoThumbnailUrl && videoUploadDate);
  const videoId = `${url}#video`;
  const creativeWork = {
    "@type": "CreativeWork",
    "@id": `${url}#creation`,
    url,
    name: creation.title,
    description: creation.description,
    inLanguage: "fr-FR",
    creator: { "@id": LNX_ARTIST_ID },
    ...(image ? { image } : {}),
    ...(publishedAt ? { datePublished: publishedAt } : {}),
    ...(creation.collaborator?.trim() ? { contributor: creation.collaborator.trim() } : {}),
    ...(creation.category?.trim() ? { genre: creation.category.trim() } : {}),
    ...(hasStructuredVideo ? { associatedMedia: { "@id": videoId } } : {}),
  };
  const videoObject = hasStructuredVideo
    ? {
        "@type": "VideoObject",
        "@id": videoId,
        url,
        contentUrl: videoContentUrl,
        name: creation.video?.name?.trim() || creation.title,
        description: creation.video?.description?.trim() || creation.description,
        thumbnailUrl: videoThumbnailUrl!,
        uploadDate: videoUploadDate!,
        ...(creation.video?.duration?.trim() ? { duration: creation.video.duration.trim() } : {}),
        creator: { "@id": LNX_ARTIST_ID },
      }
    : null;

  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbs([
        { name: "Accueil", pathname: "/" },
        { name: "Créations", pathname: "/creations" },
        { name: creation.title, pathname },
      ]),
      creativeWork,
      ...(videoObject ? [videoObject] : []),
    ],
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

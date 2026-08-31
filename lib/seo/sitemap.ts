import type { MetadataRoute } from "next";
import { canonicalPublicUrl } from "@/lib/seo/canonical";

export const PUBLIC_SITEMAP_PATHS = ["", "/discographie", "/commander", "/boutique", "/a-propos", "/contact"] as const;

export function buildPublicSitemap(
  projects: readonly Readonly<{ slug: string; status: string; featured: boolean }>[],
  products: readonly Readonly<{ slug: string }>[]= [],
): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_SITEMAP_PATHS.map((pathname) => ({
    url: canonicalPublicUrl(pathname || "/"),
    changeFrequency: pathname === "" ? "weekly" : "monthly",
    priority: pathname === "" ? 1 : 0.7,
  }));
  const projectRoutes: MetadataRoute.Sitemap = projects.map((project) => ({
    url: canonicalPublicUrl(`/album/${project.slug}`),
    changeFrequency: project.status === "PUBLISHED" ? "monthly" : "weekly",
    priority: project.featured ? 0.8 : project.status === "PUBLISHED" ? 0.65 : 0.5,
  }));
  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: canonicalPublicUrl(`/boutique/${product.slug}`),
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  return [...staticRoutes, ...projectRoutes, ...productRoutes];
}

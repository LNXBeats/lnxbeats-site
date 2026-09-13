import type { MetadataRoute } from "next";
import { listSitemapProjects } from "@/lib/catalog/queries";
import { listSitemapCreations } from "@/lib/creations/queries";
import { buildPublicSitemap } from "@/lib/seo/sitemap";
import { listPublicShopProducts } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [projects, products, creations] = await Promise.all([
    listSitemapProjects(),
    listPublicShopProducts(),
    listSitemapCreations(),
  ]);
  return buildPublicSitemap(projects, products, creations);
}

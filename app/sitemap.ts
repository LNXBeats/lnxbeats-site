import type { MetadataRoute } from "next";
import { listSitemapProjects } from "@/lib/catalog/queries";
import { listSitemapCreations } from "@/lib/creations/queries";
import { buildPublicSitemap } from "@/lib/seo/sitemap";
import { listPublicShopProducts } from "@/lib/shop/order-service";
import { isSupportEnabled } from "@/lib/support/config";
import { canonicalPublicUrl } from "@/lib/seo/canonical";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [projects, products, creations] = await Promise.all([
    listSitemapProjects(),
    listPublicShopProducts(),
    listSitemapCreations(),
  ]);
  const entries = buildPublicSitemap(projects, products, creations);
  if (isSupportEnabled()) entries.push({ url: canonicalPublicUrl("/soutenir"), changeFrequency: "monthly", priority: 0.4 });
  return entries;
}

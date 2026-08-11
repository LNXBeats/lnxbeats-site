import type { MetadataRoute } from "next";
import { siteConfig } from "@/data/site";
import { listSitemapProjects } from "@/lib/catalog/queries";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.SITE_URL ?? siteConfig.url;
  const routes = ["", "/discographie", "/commander", "/boutique", "/a-propos", "/contact"];
  const staticRoutes: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${baseUrl}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));

  const projects = await listSitemapProjects();
  const projectRoutes: MetadataRoute.Sitemap = projects.map((project) => ({
    url: `${baseUrl}/album/${project.slug}`,
    changeFrequency: project.status === "PUBLISHED" ? "monthly" : "weekly",
    priority: project.featured ? 0.8 : project.status === "PUBLISHED" ? 0.65 : 0.5,
  }));

  return [...staticRoutes, ...projectRoutes];
}

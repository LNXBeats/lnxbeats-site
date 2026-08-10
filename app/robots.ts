import type { MetadataRoute } from "next";
import { siteConfig } from "@/data/site";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.SITE_URL ?? siteConfig.url;
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/connexion", "/compte", "/admin"] },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

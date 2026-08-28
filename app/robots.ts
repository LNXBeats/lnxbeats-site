import type { MetadataRoute } from "next";
import { siteConfig } from "@/data/site";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.SITE_URL ?? siteConfig.url;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/connexion",
        "/inscription",
        "/mot-de-passe-oublie",
        "/renvoyer-verification",
        "/reinitialiser-mot-de-passe",
        "/verifier-email",
        "/compte",
        "/admin",
        "/retractation/confirmation",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN, canonicalPublicUrl } from "@/lib/seo/canonical";

export default function robots(): MetadataRoute.Robots {
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
        "/commande/",
        "/qa/",
      ],
    },
    sitemap: canonicalPublicUrl("/sitemap.xml"),
    host: CANONICAL_SITE_ORIGIN,
  };
}

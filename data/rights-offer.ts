export const personalUseTerms = {
  version: "2026-08-rights-v1",
  text: "Votre commande comprend un usage personnel. Elle ne vous autorise pas à publier, distribuer ou monétiser la création sur Spotify, Apple Music, Deezer, YouTube ou toute autre plateforme sans autorisation contractuelle préalable. LNX Beats conserve les droits correspondant à ses contributions. Lorsque l’œuvre est éligible, LNX Beats peut effectuer une déclaration auprès de la SACEM ou de tout organisme compétent et percevoir les rémunérations correspondant aux droits qu’il détient. Une exploitation non autorisée peut engager la responsabilité de son auteur.",
} as const;

export const rightsOffers = {
  PUBLICATION_LICENSE: {
    type: "PUBLICATION_LICENSE",
    priceCents: 15_000,
    currency: "EUR",
    pricingVersion: "2026-08-rights-v2",
    label: "Licence de publication",
    title: "Publier votre création",
  },
  EXPLOITATION_PARTNERSHIP: {
    type: "EXPLOITATION_PARTNERSHIP",
    priceCents: 150_000,
    currency: "EUR",
    pricingVersion: "2026-08-rights-v2",
    label: "Partenariat d’exploitation",
    title: "Construire un projet de droits partagé",
  },
} as const;

export type RightsOfferType = keyof typeof rightsOffers;

export const rightsFormVersion = "2026-08-rights-form-v1";

export const rightsPlatforms = [
  "SPOTIFY",
  "APPLE_MUSIC",
  "DEEZER",
  "YOUTUBE",
  "AMAZON_MUSIC",
  "TIKTOK",
  "INSTAGRAM",
  "OTHER",
] as const;

export type RightsPlatform = (typeof rightsPlatforms)[number];

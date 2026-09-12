export const personalUseTerms = {
  version: "2026-08-rights-v1",
  text: "Votre commande comprend un usage personnel. Elle ne vous autorise pas à publier, distribuer ou monétiser la création sur Spotify, Apple Music, Deezer, YouTube ou toute autre plateforme sans autorisation contractuelle préalable. LNX Beats conserve les droits correspondant à ses contributions. Lorsque l’œuvre est éligible, LNX Beats peut effectuer une déclaration auprès de la SACEM ou de tout organisme compétent et percevoir les rémunérations correspondant aux droits qu’il détient. Une exploitation non autorisée peut engager la responsabilité de son auteur.",
} as const;

export const publicationLicenseOffer = {
  PUBLICATION_LICENSE: {
    type: "PUBLICATION_LICENSE",
    priceCents: 15_000,
    currency: "EUR",
    pricingVersion: "2026-09-publication-license-v1",
    contractTemplateVersion: 4,
    label: "Licence de publication via distributeur",
    title: "Publier votre titre sur les plateformes",
  },
} as const;

/** The only offer that may be presented or sold by the application. */
export const rightsOffers = publicationLicenseOffer;

/** Historical request types remain readable, but are not commercial offers. */
export type RightsOfferType = "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP";
export type PublicRightsOfferType = keyof typeof rightsOffers;

export const publicationLicenseTerms = {
  version: "2026-09-publication-license-terms-v4-draft",
  status: "DRAFT",
  operatorPolicyApproved: true,
  legalReviewRequired: true,
  duration: "5 ans",
  territory: "Monde entier",
  exclusive: false,
  oneWorkOnly: true,
  oneTimePriceCents: publicationLicenseOffer.PUBLICATION_LICENSE.priceCents,
  fixedFeeLegalReviewRequired: true,
  allowedUses: [
    "Publication de l’œuvre identifiée via un distributeur numérique.",
    "Reproduction et communication au public strictement nécessaires à cette publication.",
    "Streaming et téléchargement sur les plateformes desservies par ce distributeur.",
    "Monétisation de ces exploitations pendant la durée de la licence.",
  ],
  summary: "Licence non exclusive permettant la publication d’une œuvre livrée via un distributeur numérique sur les plateformes de streaming et de téléchargement compatibles.",
  limits: [
    "Aucune cession complète de propriété intellectuelle.",
    "Sous-licence limitée aux besoins techniques du distributeur choisi.",
    "Transfert ou revente de la licence interdits.",
    "Toute adaptation substantielle nécessite un accord écrit distinct.",
    "Aucun Content ID exclusif ni revendication portant atteinte aux droits LNX Beats sans accord écrit.",
    "Crédit LNX Beats selon le rôle réellement prévu dans l’œuvre.",
  ],
  activationPolicy: {
    automaticEarlyPerformance: false,
    withdrawalPeriodDays: 14,
    uncheckedConsentRequiredForEarlyPerformance: false,
    effectiveOnlyAfter: [
      "paiement intégral confirmé côté serveur",
      "acceptation traçable du modèle contractuel applicable",
      "génération du document final valide",
      "expiration complète du délai de rétractation de quatorze jours",
    ],
  },
} as const;

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

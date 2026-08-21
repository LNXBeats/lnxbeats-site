import type { RightsPlatform } from "@/data/rights-offer";
import { humanRightsDistributor } from "@/lib/rights/human-labels";

export const missingAdminRightsValue = "Non renseigné";

const platformLabels: Record<RightsPlatform, string> = {
  SPOTIFY: "Spotify",
  APPLE_MUSIC: "Apple Music",
  DEEZER: "Deezer",
  YOUTUBE: "YouTube",
  AMAZON_MUSIC: "Amazon Music",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  OTHER: "Autre",
};

type JsonRecord = Record<string, unknown>;

export type AdminRightsSummaryRow = Readonly<{
  label: string;
  value: string;
}>;

export type AdminClientRightsWishes = Readonly<{
  platforms: readonly string[];
  platformsInput: string;
  territory: string;
  duration: string;
  monetization: boolean | null;
}>;

export type AdminRightsGrantPrefill = Readonly<{
  platforms: string;
  territory: string;
  duration: string;
  authorized: false;
  exclusive: false;
  monetization: boolean;
  adaptation: false;
  advertising: false;
  audiovisualSync: false;
  contentId: false;
  sublicense: false;
}>;

export type AdminRightsAuditTimestamp = Readonly<{
  iso: string;
  date: string;
  time: string;
  display: string;
}>;

const requestedFieldLabels: Readonly<Record<string, string>> = {
  party: "Coordonnées",
  project: "Projet",
  platforms: "Plateformes",
  territory: "Territoire",
  duration: "Durée",
  contributions: "Contributions",
  lyrics: "Paroles",
  composition: "Composition",
  production: "Production",
  aiContribution: "Apport créatif humain / IA",
  sacem: "Informations SACEM",
  credits: "Crédits",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function boolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function platformName(value: unknown) {
  return typeof value === "string" && value in platformLabels
    ? platformLabels[value as RightsPlatform]
    : "";
}

function projectFrom(formData: unknown) {
  return record(record(formData).project);
}

export function formatAdminRightsValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return text(value) || missingAdminRightsValue;
  if (Array.isArray(value)) {
    const values = value.map((item) => text(item)).filter(Boolean);
    return values.length ? values.join(" · ") : missingAdminRightsValue;
  }
  return missingAdminRightsValue;
}

export function adminClientRightsWishes(formData: unknown): AdminClientRightsWishes {
  const project = projectFrom(formData);
  const platforms = Array.isArray(project.platforms)
    ? project.platforms.map(platformName).filter(Boolean)
    : [];
  const otherPlatforms = text(project.otherPlatforms);
  const resolvedPlatforms = platforms.flatMap((platform) => platform === "Autre" && otherPlatforms
    ? [`Autre : ${otherPlatforms}`]
    : [platform]);

  return {
    platforms: resolvedPlatforms,
    platformsInput: resolvedPlatforms.join(", "),
    territory: text(project.territory),
    duration: text(project.duration),
    monetization: boolean(project.monetized),
  };
}

export function adminRightsGrantPrefill(formData: unknown): AdminRightsGrantPrefill {
  const wishes = adminClientRightsWishes(formData);
  return {
    platforms: wishes.platformsInput,
    territory: wishes.territory,
    duration: wishes.duration,
    authorized: false,
    exclusive: false,
    monetization: wishes.monetization === true,
    adaptation: false,
    advertising: false,
    audiovisualSync: false,
    contentId: false,
    sublicense: false,
  };
}

export function adminRightsProjectSummary(formData: unknown, fallbackWorkTitle: string): AdminRightsSummaryRow[] {
  const project = projectFrom(formData);
  const wishes = adminClientRightsWishes(formData);
  return [
    { label: "Titre", value: formatAdminRightsValue(text(project.workTitle) || fallbackWorkTitle) },
    { label: "Nom de publication", value: formatAdminRightsValue(project.publicationName) },
    { label: "Artiste", value: formatAdminRightsValue(project.artistName) },
    { label: "Distributeur", value: formatAdminRightsValue(humanRightsDistributor(project.distributor)) },
    { label: "Plateformes", value: formatAdminRightsValue(wishes.platforms) },
    { label: "Territoire", value: formatAdminRightsValue(project.territory) },
    { label: "Durée souhaitée", value: formatAdminRightsValue(project.duration) },
    { label: "Monétisation", value: formatAdminRightsValue(project.monetized) },
    { label: "Publicité / sponsoring", value: formatAdminRightsValue(project.advertising) },
    { label: "Content ID", value: formatAdminRightsValue(project.contentId) },
    { label: "Clips / vidéos", value: formatAdminRightsValue(project.clips) },
    { label: "Réseaux sociaux", value: formatAdminRightsValue(project.socialNetworks) },
    { label: "Modifications", value: formatAdminRightsValue(project.modifications) },
    { label: "Crédit souhaité", value: formatAdminRightsValue(project.credits) },
  ];
}

export function adminRightsAuditTimestamp(value: Date): AdminRightsAuditTimestamp {
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
  return {
    iso: value.toISOString(),
    date,
    time,
    display: `${date} · ${time}`,
  };
}

export function formatAdminRightsDateTime(value: Date | null) {
  return value ? adminRightsAuditTimestamp(value).display : "—";
}

export function adminRightsRequestedFieldLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((field): field is string => typeof field === "string")
    .map((field) => requestedFieldLabels[field])
    .filter((field): field is string => Boolean(field)))];
}

export function adminRightsDocumentVersionLabel(contractNumber: string, documentVersion: number) {
  const suffix = contractNumber.match(/-([A-Z]\d{2})$/)?.[1] ?? `V${String(documentVersion).padStart(2, "0")}`;
  return `Version ${documentVersion} — ${suffix}`;
}

export function adminRightsLatestDocumentLabel(kind: "PREAUTHORIZATION" | "CONTRACT" | "ACCEPTANCE_RECEIPT" | "SACEM_PREPARATION") {
  if (kind === "PREAUTHORIZATION") return "Dernière préautorisation";
  if (kind === "CONTRACT") return "Dernier projet de contrat";
  if (kind === "ACCEPTANCE_RECEIPT") return "Dernière preuve d’acceptation";
  return "Dernière fiche de préparation";
}

export function rightsDocumentActionLabel(documentCount: number) {
  return documentCount === 0
    ? "PRÉPARER LE PROJET DE CONTRAT"
    : "GÉNÉRER UNE NOUVELLE VERSION";
}

const adminRightsNotices: Record<string, string> = {
  "generation-refusee": "Génération refusée. Aucun document n’a été créé.",
  "generation-etape-requise": "Génération impossible à cette étape du dossier.",
  "generation-parametres-requis": "Enregistrez au moins un paramètre de droit structuré avant de générer le projet.",
  "generation-coordonnees-requises": "Les coordonnées contractuelles doivent être confirmées avant la génération.",
  "generation-modele-indisponible": "Aucun modèle contractuel utilisable n’est disponible.",
  "generation-modele-invalide": "Le modèle contractuel contient une structure ou un placeholder non autorisé.",
  "generation-stockage-indisponible": "Le stockage privé du document est momentanément indisponible.",
  "generation-page-obsolete": "La fiche a changé. Rechargez-la avant de générer une nouvelle version.",
  "generation-version-invalide": "La version attendue du document est invalide. Rechargez la fiche.",
  "generation-indisponible": "La génération est momentanément indisponible. Aucun détail technique sensible n’est affiché.",
  "projet-draft-genere": "Projet DRAFT généré. Il reste filigrané, non actif, non payable et non acceptable avant revue juridique.",
};

export function adminRightsNotice(state: string) {
  return adminRightsNotices[state]
    ?? `État : ${state.replaceAll("-", " ")}.`;
}

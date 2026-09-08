import { rightsPlatforms, type RightsOfferType, type RightsPlatform } from "@/data/rights-offer";

const partyTypes = ["INDIVIDUAL", "SOLE_PROPRIETOR", "COMPANY", "ASSOCIATION_OR_OTHER"] as const;
const contributionKinds = [
  "NONE",
  "STORY_BRIEF_ONLY",
  "LYRICS_FULL",
  "LYRICS_PARTIAL",
  "LYRICS_CO_WRITTEN",
  "MELODY",
  "MUSICAL_COMPOSITION",
  "ARRANGEMENT",
  "INSTRUMENTAL",
  "ARTISTIC_DIRECTION",
  "VOICE",
  "MIX_MASTER",
  "INSTRUMENTS",
  "PRODUCTION",
  "OTHER",
] as const;

export type RightsPartyInput = Readonly<{
  partyType: (typeof partyTypes)[number];
  firstName: string;
  lastName: string;
  artistName: string;
  companyName: string;
  legalForm: string;
  legalRepresentative: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  siret: string;
  vatNumber: string;
  contractEmail: string;
  phone: string;
}>;

export type RightsContributionInput = Readonly<{
  kind: (typeof contributionKinds)[number];
  description: string;
  claimedPercentage: number | null;
  evidenceNote: string;
}>;

export type RightsProjectInput = Readonly<{
  workTitle: string;
  publicationName: string;
  artistName: string;
  distributor: string;
  platforms: readonly RightsPlatform[];
  otherPlatforms: string;
  targetDate: string;
  monetized: boolean;
  territory: string;
  duration: string;
  clips: string;
  socialNetworks: string;
  advertising: boolean;
  contentId: boolean;
  modifications: string;
  credits: string;
}>;

export type PartnershipInput = Readonly<{
  lyricsAuthor: string;
  lyricsProvided: string;
  lyricRewrites: string;
  lyricsClaimedPercentage: number | null;
  melody: string;
  harmony: string;
  structure: string;
  arrangement: string;
  instrumental: string;
  compositionClaimedPercentage: number | null;
  artisticDirection: string;
  voice: string;
  mixMaster: string;
  instruments: string;
  production: string;
  toolsUsed: string;
  aiKnown: boolean;
  humanCreativeContribution: string;
  sacemMember: boolean;
  sacemIdentifier: string;
  otherCollective: string;
  relatedWorks: string;
  desiredSplit: string;
}>;

export type RightsDraftInput = Readonly<{
  type: RightsOfferType;
  party: RightsPartyInput;
  project: RightsProjectInput;
  contributions: readonly RightsContributionInput[];
  partnership: PartnershipInput | null;
}>;

export class RightsInputError extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) {
    super(message);
    this.name = "RightsInputError";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RightsInputError("INVALID_INPUT", "Le formulaire est invalide.", field);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new RightsInputError("UNEXPECTED_FIELD", "Un champ inattendu a été refusé.", field);
}

function text(value: unknown, field: string, max: number, required = false) {
  if (typeof value !== "string") throw new RightsInputError("INVALID_TEXT", "Une information est invalide.", field);
  const normalized = value.normalize("NFKC").trim();
  if ((required && !normalized) || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new RightsInputError("INVALID_TEXT", "Une information est invalide.", field);
  }
  return normalized;
}

function bool(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new RightsInputError("INVALID_BOOLEAN", "Une réponse est invalide.", field);
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new RightsInputError("INVALID_CHOICE", "Un choix est invalide.", field);
  return value as T[number];
}

function optionalPercent(value: unknown, field: string) {
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) throw new RightsInputError("INVALID_PERCENT", "Le pourcentage revendiqué est invalide.", field);
  return Number(value);
}

function party(value: unknown): RightsPartyInput {
  const input = record(value, "party");
  exactKeys(input, ["partyType", "firstName", "lastName", "artistName", "companyName", "legalForm", "legalRepresentative", "streetAddress", "postalCode", "city", "country", "siret", "vatNumber", "contractEmail", "phone"], "party");
  const partyType = enumValue(input.partyType, partyTypes, "party.partyType");
  const individual = partyType === "INDIVIDUAL" || partyType === "SOLE_PROPRIETOR";
  const firstName = text(input.firstName, "party.firstName", 100, individual);
  const lastName = text(input.lastName, "party.lastName", 100, individual);
  const companyName = text(input.companyName, "party.companyName", 240, !individual);
  const legalRepresentative = text(input.legalRepresentative, "party.legalRepresentative", 200, !individual);
  const contractEmail = text(input.contractEmail, "party.contractEmail", 320, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contractEmail)) throw new RightsInputError("INVALID_EMAIL", "L’e-mail contractuel est invalide.", "party.contractEmail");
  const country = text(input.country, "party.country", 2, true).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new RightsInputError("INVALID_COUNTRY", "Le pays doit utiliser un code à deux lettres.", "party.country");
  const siret = text(input.siret, "party.siret", 14);
  if (siret && !/^\d{14}$/.test(siret)) throw new RightsInputError("INVALID_SIRET", "Le SIRET est invalide.", "party.siret");
  return {
    partyType,
    firstName,
    lastName,
    artistName: text(input.artistName, "party.artistName", 180),
    companyName,
    legalForm: text(input.legalForm, "party.legalForm", 120),
    legalRepresentative,
    streetAddress: text(input.streetAddress, "party.streetAddress", 300, true),
    postalCode: text(input.postalCode, "party.postalCode", 24, true),
    city: text(input.city, "party.city", 140, true),
    country,
    siret,
    vatNumber: text(input.vatNumber, "party.vatNumber", 32),
    contractEmail,
    phone: text(input.phone, "party.phone", 40),
  };
}

function project(value: unknown): RightsProjectInput {
  const input = record(value, "project");
  exactKeys(input, ["workTitle", "publicationName", "artistName", "distributor", "platforms", "otherPlatforms", "targetDate", "monetized", "territory", "duration", "clips", "socialNetworks", "advertising", "contentId", "modifications", "credits"], "project");
  if (!Array.isArray(input.platforms) || input.platforms.length > rightsPlatforms.length) throw new RightsInputError("INVALID_PLATFORMS", "Les plateformes sont invalides.", "project.platforms");
  const platforms = [...new Set(input.platforms.map((item) => enumValue(item, rightsPlatforms, "project.platforms")))];
  if (!platforms.length) throw new RightsInputError("INVALID_PLATFORMS", "Sélectionnez au moins une plateforme ou le choix Autre.", "project.platforms");
  const targetDate = text(input.targetDate, "project.targetDate", 10);
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new RightsInputError("INVALID_DATE", "La date cible est invalide.", "project.targetDate");
  return {
    workTitle: text(input.workTitle, "project.workTitle", 240, true),
    publicationName: text(input.publicationName, "project.publicationName", 240),
    artistName: text(input.artistName, "project.artistName", 180, true),
    distributor: text(input.distributor, "project.distributor", 180),
    platforms,
    otherPlatforms: text(input.otherPlatforms, "project.otherPlatforms", 500, platforms.includes("OTHER")),
    targetDate,
    monetized: bool(input.monetized, "project.monetized"),
    territory: text(input.territory, "project.territory", 240, true),
    duration: text(input.duration, "project.duration", 240, true),
    clips: text(input.clips, "project.clips", 1_000),
    socialNetworks: text(input.socialNetworks, "project.socialNetworks", 1_000),
    advertising: bool(input.advertising, "project.advertising"),
    contentId: bool(input.contentId, "project.contentId"),
    modifications: text(input.modifications, "project.modifications", 2_000),
    credits: text(input.credits, "project.credits", 1_000),
  };
}

function contributions(value: unknown): RightsContributionInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new RightsInputError("INVALID_CONTRIBUTIONS", "Déclarez votre contribution.", "contributions");
  return value.map((item, index) => {
    const input = record(item, `contributions.${index}`);
    exactKeys(input, ["kind", "description", "claimedPercentage", "evidenceNote"], `contributions.${index}`);
    return {
      kind: enumValue(input.kind, contributionKinds, `contributions.${index}.kind`),
      description: text(input.description, `contributions.${index}.description`, 4_000, true),
      claimedPercentage: optionalPercent(input.claimedPercentage, `contributions.${index}.claimedPercentage`),
      evidenceNote: text(input.evidenceNote, `contributions.${index}.evidenceNote`, 4_000),
    };
  });
}

export function parseRightsDraftInput(value: unknown): RightsDraftInput {
  const input = record(value, "request");
  exactKeys(input, ["type", "party", "project", "contributions", "partnership"], "request");
  const type = enumValue(input.type, ["PUBLICATION_LICENSE"] as const, "type");
  return {
    type,
    party: party(input.party),
    project: project(input.project),
    contributions: contributions(input.contributions),
    partnership: null,
  };
}

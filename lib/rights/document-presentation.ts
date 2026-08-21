import "server-only";

import type { ContractPdfSection } from "@/lib/rights/pdf";
import { humanRightsDistributor } from "@/lib/rights/human-labels";

export { humanRightsDistributor } from "@/lib/rights/human-labels";

type ContractParty = Readonly<{
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
}>;

type ContractGrant = Readonly<{
  kind: string;
  authorized: boolean;
  exclusive: boolean;
  destination?: string | null;
  platforms: unknown;
  territory?: string | null;
  duration?: string | null;
  monetization: boolean;
  adaptation: boolean;
  advertising: boolean;
  audiovisualSync: boolean;
  contentId: boolean;
  sublicense: boolean;
  credit?: string | null;
  restrictions?: string | null;
}>;

type ContractContribution = Readonly<{
  kind: string;
  description: string;
  claimedPercentage: number | null;
}>;

export type RightsDocumentPresentationInput = Readonly<{
  kind: "PREAUTHORIZATION" | "CONTRACT" | "SACEM_PREPARATION";
  requestType: "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP";
  workTitle: string;
  orderNumber: string;
  requestedPriceCents: number;
  formData: unknown;
  party: ContractParty;
  grants: readonly ContractGrant[];
  contributions: readonly ContractContribution[];
  splitProposal?: Readonly<{
    version?: number;
    clientSharePercent: number;
    lnxSharePercent: number;
    nature?: string;
    comment?: string | null;
    contributionRationale: string;
    proposedRoles?: unknown;
  }> | null;
  aiAssessment: string;
}>;

const grantLabels: Readonly<Record<string, string>> = {
  PUBLICATION: "Publication",
  DISTRIBUTION: "Distribution",
  PUBLIC_COMMUNICATION: "Communication publique",
  REPRODUCTION: "Reproduction",
  MONETIZATION: "Monétisation",
  ADAPTATION: "Adaptation / modification",
  ADVERTISING: "Publicité",
  AUDIOVISUAL_SYNCHRONIZATION: "Synchronisation audiovisuelle",
  CONTENT_ID: "Content ID",
  SUBLICENSE: "Sous-licence",
  CREDIT: "Crédit",
  OTHER: "Autre droit",
};

const contributionLabels: Readonly<Record<string, string>> = {
  NONE: "Aucune contribution créative",
  STORY_BRIEF_ONLY: "Histoire / brief uniquement",
  LYRICS_FULL: "Paroles entièrement fournies",
  LYRICS_PARTIAL: "Paroles partiellement fournies",
  LYRICS_CO_WRITTEN: "Paroles coécrites",
  MELODY: "Mélodie fournie",
  MUSICAL_COMPOSITION: "Composition musicale",
  ARRANGEMENT: "Arrangement",
  INSTRUMENTAL: "Instrumental",
  ARTISTIC_DIRECTION: "Direction artistique",
  VOICE: "Voix",
  MIX_MASTER: "Mix / master",
  INSTRUMENTS: "Instruments",
  PRODUCTION: "Production",
  OTHER: "Autre contribution",
};

const platformLabels: Readonly<Record<string, string>> = {
  SPOTIFY: "Spotify",
  APPLE_MUSIC: "Apple Music",
  DEEZER: "Deezer",
  YOUTUBE: "YouTube",
  AMAZON_MUSIC: "Amazon Music",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  OTHER: "Autre plateforme",
};

const aiAssessmentLabels: Readonly<Record<string, string>> = {
  NOT_REVIEWED: "Non revue",
  HUMAN_CONTRIBUTION_DOCUMENTED: "Apport créatif humain documenté",
  LEGAL_REVIEW_REQUIRED: "Revue juridique requise",
  DECLARATION_NOT_RECOMMENDED: "Déclaration non recommandée",
  POTENTIALLY_ELIGIBLE: "Potentiellement éligible",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "À définir") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function label(value: string, labels: Readonly<Record<string, string>>, fallback: string) {
  return labels[value] ?? fallback;
}

export function humanRightsPlatform(value: string) {
  if (platformLabels[value]) return platformLabels[value];
  return /^[A-Z][A-Z0-9_]*$/.test(value) ? "Autre plateforme" : value;
}

export function humanRightsContribution(value: string) {
  return label(value, contributionLabels, "Contribution déclarée");
}

export function formatRightsCurrency(amountCents: number, currency = "EUR") {
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error("RIGHTS_PRICE_INVALID");
  }

  const hasFraction = Math.abs(amountCents % 100) !== 0;
  const number = new Intl.NumberFormat("fr-FR", {
    useGrouping: true,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).formatToParts(amountCents / 100).map((part) => {
    if (part.type === "group") return " ";
    if (part.type === "decimal") return ",";
    return part.value;
  }).join("");

  return `${number} ${currency === "EUR" ? "€" : currency}`;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function unique(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function joined(values: readonly string[], fallback = "Non défini") {
  return values.length ? values.join(" ; ") : fallback;
}

function sentence(value: string) {
  return /[.!?…]$/.test(value) ? value : `${value}.`;
}

function yesNo(value: boolean) {
  return value ? "oui" : "non";
}

function clientBoolean(value: unknown) {
  return value === true ? "Oui" : value === false ? "Non" : "Non renseigné";
}

function optionalParagraph(labelText: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return `${labelText} : ${sentence(value.trim())}`;
}

function partnershipPreauthorizationSections(
  input: RightsDocumentPresentationInput,
  project: Record<string, unknown>,
  partyName: string,
  authorized: readonly ContractGrant[],
): ContractPdfSection[] {
  const partnership = record(record(input.formData).partnership);
  const adminPlatforms = unique(authorized.flatMap((grant) => stringList(grant.platforms).map(humanRightsPlatform)));
  const requestedPlatforms = stringList(project.platforms).map(humanRightsPlatform);
  const adminTerritories = unique(authorized.map((grant) => grant.territory));
  const adminDurations = unique(authorized.map((grant) => grant.duration));
  const creativeElements = [
    optionalParagraph("Auteur des paroles déclaré", partnership.lyricsAuthor),
    optionalParagraph("Textes fournis", partnership.lyricsProvided),
    optionalParagraph("Réécritures déclarées", partnership.lyricRewrites),
    optionalParagraph("Mélodie", partnership.melody),
    optionalParagraph("Harmonie", partnership.harmony),
    optionalParagraph("Structure", partnership.structure),
    optionalParagraph("Arrangement", partnership.arrangement),
    optionalParagraph("Instrumental", partnership.instrumental),
    optionalParagraph("Direction artistique", partnership.artisticDirection),
    optionalParagraph("Voix", partnership.voice),
    optionalParagraph("Mix / master", partnership.mixMaster),
    optionalParagraph("Instruments", partnership.instruments),
    optionalParagraph("Production", partnership.production),
  ].filter((paragraph): paragraph is string => Boolean(paragraph));
  const contributionParagraphs = input.contributions.length ? input.contributions.map((item) => {
    const percentage = item.claimedPercentage === null ? "" : ` Pourcentage revendiqué : ${item.claimedPercentage} %.`;
    return `${humanRightsContribution(item.kind)} : ${sentence(item.description)}${percentage} Cette déclaration du client reste à vérifier et ne constitue pas une reconnaissance juridique par LNX Beats.`;
  }) : ["Aucune contribution créative n’a été déclarée dans cette demande."];
  const projectUses = [
    `Exploitation monétisée envisagée : ${clientBoolean(project.monetized)}.`,
    `Publicité ou sponsoring envisagé : ${clientBoolean(project.advertising)}.`,
    `Utilisation de Content ID envisagée : ${clientBoolean(project.contentId)}.`,
    optionalParagraph("Clips ou vidéos envisagés", project.clips),
    optionalParagraph("Réseaux sociaux envisagés", project.socialNetworks),
    optionalParagraph("Modifications envisagées", project.modifications),
    optionalParagraph("Crédits souhaités", project.credits),
  ].filter((paragraph): paragraph is string => Boolean(paragraph));
  const sacemFacts = [
    `Adhésion SACEM déclarée par le client : ${clientBoolean(partnership.sacemMember)}.`,
    optionalParagraph("Identifiant SACEM déclaré", partnership.sacemIdentifier),
    optionalParagraph("Autre société de gestion collective", partnership.otherCollective),
    optionalParagraph("Œuvres liées déjà déclarées", partnership.relatedWorks),
    "Ces déclarations ne reconnaissent aucune qualité d’auteur ou de compositeur et n’attribuent aucune quote-part. Aucune déclaration SACEM n’est préparée ni transmise automatiquement.",
  ].filter((paragraph): paragraph is string => Boolean(paragraph));
  const requestedSplit = typeof partnership.desiredSplit === "string" && partnership.desiredSplit.trim()
    ? partnership.desiredSplit.trim()
    : null;
  const territoryParagraph = adminTerritories.length
    ? `Territoire retenu par LNX Beats pour la poursuite de l’étude : ${adminTerritories.join(" ; ")}.`
    : `Territoire souhaité par le client : ${text(project.territory, "Non renseigné")}.`;
  const durationParagraph = adminDurations.length
    ? `Durée retenue par LNX Beats pour la poursuite de l’étude : ${adminDurations.join(" ; ")}.`
    : `Durée souhaitée par le client : ${text(project.duration, "Non renseignée")}.`;
  const platformParagraph = adminPlatforms.length
    ? `Plateformes retenues par LNX Beats pour la poursuite de l’étude : ${adminPlatforms.join(", ")}.`
    : `Plateformes souhaitées par le client : ${requestedPlatforms.length ? requestedPlatforms.join(", ") : "Non renseignées"}.`;

  return [
    { title: "1. Parties", paragraphs: [`LNX Beats et ${partyName}, ${input.party.streetAddress}, ${input.party.postalCode} ${input.party.city}, ${input.party.country}.`] },
    { title: "2. Création concernée", paragraphs: [`Création : ${input.workTitle}. Commande : ${input.orderNumber}. Artiste déclaré : ${text(project.artistName, partyName)}.`] },
    { title: "3. Objet de la préautorisation", paragraphs: ["Cette préautorisation prépare l’étude d’un éventuel partenariat d’exploitation. Elle rassemble les déclarations du client et les paramètres disponibles afin de permettre une revue par LNX Beats. Elle n’accorde aucun droit."] },
    { title: "4. Projet d’exploitation envisagé", paragraphs: [`Nom de publication déclaré : ${text(project.publicationName, input.workTitle)}. Distributeur envisagé : ${humanRightsDistributor(project.distributor)}. Date cible déclarée : ${text(project.targetDate, "Non renseignée")}.`] },
    { title: "5. Plateformes et supports souhaités", paragraphs: [platformParagraph, ...(typeof project.otherPlatforms === "string" && project.otherPlatforms.trim() ? [`Autres supports déclarés : ${project.otherPlatforms.trim()}.`] : [])] },
    { title: "6. Territoire et durée souhaités", paragraphs: [territoryParagraph, durationParagraph, "Ces éléments restent déclaratifs tant qu’ils n’ont pas été retenus dans un document contractuel revu."] },
    { title: "7. Monétisation et usages envisagés", paragraphs: projectUses },
    { title: "8. Contributions déclarées par le client", paragraphs: contributionParagraphs },
    { title: "9. Éléments créatifs fournis", paragraphs: creativeElements.length ? creativeElements : ["Aucun élément créatif détaillé supplémentaire n’a été renseigné."] },
    { title: "10. Outils et processus déclarés", paragraphs: [optionalParagraph("Outils et processus", partnership.toolsUsed) ?? "Aucun outil ou processus n’a été renseigné."] },
    { title: "11. Apport créatif humain déclaré", paragraphs: [optionalParagraph("Apport créatif humain", partnership.humanCreativeContribution) ?? "Aucun apport créatif humain détaillé n’a été renseigné.", "Cette déclaration doit être examinée ; elle ne suffit pas à établir une qualité juridique ni une éligibilité à une société de gestion collective."] },
    { title: "12. Intelligence artificielle et outils génératifs", paragraphs: [`Intervention d’IA connue déclarée par le client : ${clientBoolean(partnership.aiKnown)}.`, "L’absence d’IA déclarée ne vaut pas certification. Toute éligibilité éventuelle dépend notamment de la réalité et de la documentation de l’apport créatif humain, sous réserve d’une revue juridique."] },
    { title: "13. SACEM et gestion collective", paragraphs: sacemFacts },
    { title: "14. Proposition de répartition non contraignante", paragraphs: [requestedSplit ? `Souhait exprimé par le client : ${sentence(requestedSplit)}` : "Aucune proposition de répartition n’a été formulée.", "Aucune répartition n’est arrêtée à ce stade. Une proposition commerciale éventuelle ne constitue pas automatiquement une clé de répartition SACEM et ne lie pas LNX Beats sans validation explicite."] },
    { title: "15. Prix envisagé et absence de paiement", paragraphs: [`Prix envisagé du partenariat : ${formatRightsCurrency(input.requestedPriceCents)}. Aucun paiement au titre de ce partenariat n’est ouvert à ce stade. Aucun droit n’est actif.`] },
    { title: "16. Limites de la préautorisation", paragraphs: ["Ce document ne transfère ni propriété de l’œuvre, ni droits moraux, ni qualité d’auteur ou de compositeur, ni droits patrimoniaux, ni quote-part SACEM. Les droits non expressément accordés par un futur contrat restent non accordés."] },
    { title: "17. Entrée en vigueur", paragraphs: ["La préautorisation n’entre pas en vigueur comme contrat. Une activation future exigerait au minimum un modèle juridiquement approuvé, les acceptations requises, une validation distincte de LNX Beats, un paiement confirmé et l’absence d’anomalie."] },
    { title: "18. Rétractation et commencement anticipé", paragraphs: ["Les règles de rétractation et de commencement anticipé restent soumises à validation juridique. Aucune renonciation n’est précochée et aucune exception n’est appliquée automatiquement."] },
    { title: "19. Statut DRAFT et revue juridique", paragraphs: ["PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE. Ce document n’accorde aucun droit et ne constitue pas une consultation juridique. Une relecture par un professionnel du droit de la propriété intellectuelle demeure obligatoire avant toute ouverture publique."] },
  ];
}

function partnershipContractSections(
  input: RightsDocumentPresentationInput,
  project: Record<string, unknown>,
  partyName: string,
  authorized: readonly ContractGrant[],
): ContractPdfSection[] {
  const destinations = unique(authorized.map((grant) => grant.destination));
  const platforms = unique(authorized.flatMap((grant) => stringList(grant.platforms).map(humanRightsPlatform)));
  const territories = unique(authorized.map((grant) => grant.territory));
  const durations = unique(authorized.map((grant) => grant.duration));
  const credits = unique(authorized.map((grant) => grant.credit));
  const restrictions = unique(authorized.map((grant) => grant.restrictions));
  const split = input.splitProposal ?? null;
  const proposedRoles = split ? stringList(split.proposedRoles) : [];
  const total = split ? split.clientSharePercent + split.lnxSharePercent : null;
  const grantParagraphs = input.grants.length ? input.grants.map((grant) => [
    `${label(grant.kind, grantLabels, "Droit examiné")} : ${grant.authorized ? "envisagé comme autorisé" : "non accordé"}`,
    grant.authorized ? grant.exclusive ? "exclusif" : "non exclusif" : null,
    grant.authorized ? `monétisation : ${yesNo(grant.monetization)}` : null,
    grant.authorized ? `adaptation : ${yesNo(grant.adaptation)}` : null,
    grant.authorized ? `publicité : ${yesNo(grant.advertising)}` : null,
    grant.authorized ? `synchronisation audiovisuelle : ${yesNo(grant.audiovisualSync)}` : null,
    grant.authorized ? `Content ID : ${yesNo(grant.contentId)}` : null,
    grant.authorized ? `sous-licence : ${yesNo(grant.sublicense)}` : null,
  ].filter(Boolean).join(" ; ") + ".") : ["Aucun paramètre d’exploitation n’a été retenu dans ce projet."];
  const contributionParagraphs = input.contributions.length ? input.contributions.map((item) => {
    const percentage = item.claimedPercentage === null ? "" : ` Quote-part revendiquée par le client : ${item.claimedPercentage} %.`;
    return `${humanRightsContribution(item.kind)} : ${sentence(item.description)}${percentage} Cette déclaration reste à vérifier et ne vaut pas reconnaissance juridique par LNX Beats.`;
  }) : ["Aucune contribution créative n’a été déclarée par le client."];
  const assessment = input.aiAssessment === "HUMAN_CONTRIBUTION_DOCUMENTED"
    ? "L’étude interne relève un apport humain documenté, sous réserve de l’analyse juridique applicable. Cette évaluation ne reconnaît pas à elle seule une qualité d’auteur ou de compositeur."
    : `Évaluation interne : ${label(input.aiAssessment, aiAssessmentLabels, "Analyse à compléter")}. Elle reste soumise à l’analyse juridique applicable.`;
  const splitParagraphs = split ? [
    `Proposition commerciale${split.version ? ` version ${split.version}` : ""} : Client : ${split.clientSharePercent} %. LNX Beats : ${split.lnxSharePercent} %. Total : ${total} %.`,
    `Nature : ${sentence(text(split.nature, "Proposition contractuelle à étudier"))}`,
    `Justification : ${sentence(split.contributionRationale)}`,
    `Rôles envisagés : ${sentence(joined(proposedRoles, "À définir après étude"))}`,
    ...(split.comment?.trim() ? [`Commentaire : ${sentence(split.comment.trim())}`] : []),
  ] : ["Aucune proposition commerciale de répartition n’a été arrêtée dans ce projet."];

  return [
    { title: "1. Parties", paragraphs: [`LNX Beats et ${partyName}, ${input.party.streetAddress}, ${input.party.postalCode} ${input.party.city}, ${input.party.country}.`] },
    { title: "2. Œuvre concernée", paragraphs: [`Œuvre : ${input.workTitle}. Commande : ${input.orderNumber}.`] },
    { title: "3. Objet du partenariat d’exploitation", paragraphs: [`Le présent document est un projet de partenariat d’exploitation portant sur l’œuvre concernée. Il ne rend pas le partenariat actif. Nom de publication déclaré : ${text(project.publicationName, input.workTitle)}. Distributeur envisagé : ${humanRightsDistributor(project.distributor)}.`] },
    { title: "4. Paramètres d’exploitation envisagés", paragraphs: grantParagraphs },
    { title: "5. Destination", paragraphs: [`Destination contractuelle envisagée : ${sentence(joined(destinations))}`] },
    { title: "6. Plateformes / supports", paragraphs: [`Plateformes expressément envisagées : ${sentence(platforms.length ? platforms.join(", ") : "Aucune plateforme expressément retenue")}`] },
    { title: "7. Territoire", paragraphs: [`Territoire contractuel envisagé : ${joined(territories)}.`] },
    { title: "8. Durée", paragraphs: [`Durée contractuelle envisagée : ${joined(durations)}.`] },
    { title: "9. Crédit", paragraphs: [`Crédit envisagé : ${joined(credits)}.`] },
    { title: "10. Restrictions", paragraphs: restrictions.length ? restrictions.map(sentence) : ["Les droits non expressément envisagés restent non accordés."] },
    { title: "11. Contributions déclarées", paragraphs: contributionParagraphs },
    { title: "12. Apport créatif et rôles envisagés", paragraphs: [assessment, split && proposedRoles.length ? `Rôles envisagés dans la proposition commerciale : ${sentence(proposedRoles.join(" ; "))}` : "Les rôles restent à déterminer après étude des contributions."] },
    { title: "13. Proposition commerciale de répartition", paragraphs: splitParagraphs },
    { title: "14. Nature non contraignante de la proposition", paragraphs: ["Cette proposition commerciale reste soumise à contractualisation et à revue juridique. Elle n’est pas automatiquement une clé de répartition SACEM, ne lie pas définitivement les parties et n’accorde actuellement aucun droit actif."] },
    { title: "15. SACEM / gestion collective", paragraphs: ["Ce projet ne reconnaît automatiquement aucune qualité d’auteur ou de compositeur, ne transfère aucun droit moral, ne crée aucune quote-part ni répartition SACEM et ne déclenche aucune déclaration auprès de la SACEM ou d’un autre organisme de gestion collective."] },
    { title: "16. Prix envisagé du partenariat", paragraphs: [`Prix envisagé du partenariat : ${formatRightsCurrency(input.requestedPriceCents)}. Aucun paiement au titre de ce partenariat n’est ouvert à ce stade. Aucun droit n’est actif.`] },
    { title: "17. Entrée en vigueur", paragraphs: ["Le présent projet ne suffit pas à rendre le partenariat actif. Une entrée en vigueur future resterait notamment conditionnée à un modèle juridiquement approuvé, à la revue juridique requise, aux acceptations nécessaires, à la validation de LNX Beats, au paiement futur confirmé si le parcours définitif le prévoit, à l’absence d’anomalie et aux autres conditions du contrat définitif."] },
    { title: "18. Rétractation / règles à valider", paragraphs: ["Les règles de rétractation et de commencement anticipé restent soumises à validation juridique. Aucune renonciation n’est précochée et aucune exception n’est appliquée automatiquement."] },
    { title: "19. Statut DRAFT / validation juridique", paragraphs: ["PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE. Ce document reste soumis à la relecture d’un professionnel du droit de la propriété intellectuelle."] },
  ];
}

export function buildRightsDocumentSections(input: RightsDocumentPresentationInput): ContractPdfSection[] {
  const project = record(record(input.formData).project);
  const partyName = input.party.companyName || [input.party.firstName, input.party.lastName].filter(Boolean).join(" ");
  const authorized = input.grants.filter((grant) => grant.authorized);

  if (input.kind === "PREAUTHORIZATION" && input.requestType === "EXPLOITATION_PARTNERSHIP") {
    return partnershipPreauthorizationSections(input, project, partyName, authorized);
  }

  if (input.kind === "CONTRACT" && input.requestType === "EXPLOITATION_PARTNERSHIP") {
    return partnershipContractSections(input, project, partyName, authorized);
  }

  if (input.kind === "SACEM_PREPARATION") {
    return [
      { title: "Nature du document", paragraphs: ["FICHE DE PRÉPARATION - DÉCLARATION ÉVENTUELLE. Ce document n’est pas une déclaration SACEM et n’est envoyé automatiquement à aucun organisme."] },
      { title: "Œuvre et parties", paragraphs: [`Création : ${input.workTitle}. Client : ${partyName}.`] },
      { title: "Contributions et rôles envisagés", paragraphs: input.contributions.length ? input.contributions.map((item) => `${label(item.kind, contributionLabels, "Contribution déclarée")} : ${item.description}`) : ["Aucune contribution déclarée."] },
      { title: "Proposition commerciale", paragraphs: [input.splitProposal ? `${input.splitProposal.clientSharePercent} % client / ${input.splitProposal.lnxSharePercent} % LNX Beats. ${input.splitProposal.contributionRationale}` : "Aucune proposition validée.", "Cette proposition n’est pas automatiquement une clé de répartition SACEM."] },
      { title: "Éligibilité interne", paragraphs: [`Évaluation : ${label(input.aiAssessment, aiAssessmentLabels, "Évaluation interne à compléter")}. Points à vérifier juridiquement avant toute déclaration.`] },
    ];
  }

  const destinations = unique(authorized.map((grant) => grant.destination));
  const platforms = unique(authorized.flatMap((grant) => stringList(grant.platforms).map(humanRightsPlatform)));
  const territories = unique(authorized.map((grant) => grant.territory));
  const durations = unique(authorized.map((grant) => grant.duration));
  const credits = unique(authorized.map((grant) => grant.credit));
  const restrictions = unique(authorized.map((grant) => grant.restrictions));
  const grantParagraphs = input.grants.length ? input.grants.map((grant) => [
    `${label(grant.kind, grantLabels, "Droit examiné")} : ${grant.authorized ? "autorisé" : "non accordé"}`,
    grant.authorized ? grant.exclusive ? "exclusif" : "non exclusif" : null,
    grant.authorized ? `monétisation : ${yesNo(grant.monetization)}` : null,
    grant.authorized ? `adaptation : ${yesNo(grant.adaptation)}` : null,
    grant.authorized ? `publicité : ${yesNo(grant.advertising)}` : null,
    grant.authorized ? `synchronisation audiovisuelle : ${yesNo(grant.audiovisualSync)}` : null,
    grant.authorized ? `Content ID : ${yesNo(grant.contentId)}` : null,
    grant.authorized ? `sous-licence : ${yesNo(grant.sublicense)}` : null,
  ].filter(Boolean).join(" ; ") + ".") : ["Aucun droit n’est expressément accordé dans ce projet. Les droits non listés restent non accordés."];

  return [
    { title: "1. Parties", paragraphs: [`LNX Beats et ${partyName}, ${input.party.streetAddress}, ${input.party.postalCode} ${input.party.city}, ${input.party.country}.`] },
    { title: "2. Œuvre concernée", paragraphs: [`Œuvre : ${input.workTitle}. Commande ${input.orderNumber}.`] },
    { title: "3. Objet de la licence", paragraphs: [`Offre : licence de publication. Nom de publication demandé : ${text(project.publicationName)}. Distributeur envisagé : ${humanRightsDistributor(project.distributor)}.`, `Destination contractuelle retenue : ${sentence(joined(destinations))}`] },
    { title: "4. Droits expressément accordés", paragraphs: grantParagraphs },
    { title: "5. Supports / plateformes", paragraphs: [`Plateformes expressément retenues : ${sentence(platforms.length ? platforms.join(", ") : "Aucune plateforme expressément autorisée")}`] },
    { title: "6. Territoire", paragraphs: [`Territoire contractuel : ${joined(territories)}.`] },
    { title: "7. Durée", paragraphs: [`Durée contractuelle : ${joined(durations)}.`] },
    { title: "8. Monétisation", paragraphs: [`Monétisation autorisée : ${yesNo(authorized.some((grant) => grant.monetization))}.`] },
    { title: "9. Crédit", paragraphs: [`Crédit retenu : ${joined(credits)}.`] },
    { title: "10. Restrictions", paragraphs: restrictions.length ? restrictions : ["Les droits non expressément accordés restent non accordés."] },
    { title: "11. Prix / rémunération", paragraphs: [`Prix envisagé de la licence : ${formatRightsCurrency(input.requestedPriceCents)}. Aucun paiement au titre de cette licence n’est ouvert à ce stade. Aucun droit n’est actif.`] },
    { title: "12. Contributions déclarées", paragraphs: input.contributions.length ? input.contributions.map((item) => `${label(item.kind, contributionLabels, "Contribution déclarée")} : ${item.description}${item.claimedPercentage === null ? "" : ` (${item.claimedPercentage} % revendiqués par le client)`}. Cette déclaration reste à vérifier.`) : ["Aucune contribution créative déclarée par le client."] },
    { title: "13. SACEM / gestion collective", paragraphs: ["Ce document ne transfère ni la qualité d’auteur, ni les droits moraux, ni une quote-part SACEM. Une proposition entre les parties n’est pas une répartition SACEM automatique.", input.requestType === "EXPLOITATION_PARTNERSHIP" && input.splitProposal ? `Proposition commerciale : ${input.splitProposal.clientSharePercent} % client / ${input.splitProposal.lnxSharePercent} % LNX Beats, sous réserve d’étude et de validation.` : "Aucune répartition n’est promise. Aucune déclaration SACEM n’est effectuée dans cette version."] },
    { title: "14. Entrée en vigueur", paragraphs: ["L’acceptation du présent projet ne suffit pas à rendre la licence active. L’entrée en vigueur demeure notamment subordonnée à la validation juridique du modèle, à la validation de LNX Beats, au paiement du montant convenu et à la satisfaction des conditions prévues au contrat définitif."] },
    { title: "15. Rétractation / règles à valider", paragraphs: ["Les règles de rétractation et de commencement anticipé sont en attente de validation juridique. Aucune renonciation n’est précochée."] },
    { title: "16. Statut DRAFT / validation juridique", paragraphs: ["PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE. Ce document reste soumis à la relecture d’un professionnel du droit de la propriété intellectuelle."] },
  ];
}

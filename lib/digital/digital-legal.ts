import { createHash } from "node:crypto";
import { approvedLegalDocuments, consumerMediatorInformation } from "@/data/legal";

/** Independent draft: does not replace MUSIC_TERMS (Commander), SHOP_TERMS, Rights or their approved evidence. */
export const DIGITAL_MUSIC_TERMS_DRAFT_VERSION = "digital-music-cgv-20261014-consolidation-draft-01";
export const DIGITAL_MUSIC_IMMEDIATE_SUPPLY_DRAFT = "Je demande expressément le commencement de la fourniture de ces contenus numériques avant la fin du délai de rétractation applicable. Formulation DCN proposée, à valider par territoire avant LIVE.";
export const DIGITAL_MUSIC_WITHDRAWAL_DRAFT = "Je reconnais que, lorsque les conditions légales applicables sont réunies, je peux perdre mon droit de rétractation après consentement exprès, confirmation sur support durable et commencement de la fourniture. Les garanties légales et les autres recours restent préservés. Formulation QA non approuvée pour LIVE.";

export type DigitalLegalDraft = {
  type: "DIGITAL_MUSIC_TERMS" | "DIGITAL_PRIVACY_ADDENDUM";
  version: string; title: string; status: "DRAFT"; createdAt: string; effectiveAt: null;
  approvedAt: null; approvedBy: null; legalReviewReference: null;
  sections: ReadonlyArray<{ title: string; paragraphs: readonly string[] }>;
  reviewRequired: readonly string[]; hashSha256: string;
};
function draft(input: Omit<DigitalLegalDraft, "hashSha256">): Readonly<DigitalLegalDraft> {
  return Object.freeze({ ...input, hashSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex") });
}
const mediator = consumerMediatorInformation;
const common = { status: "DRAFT", createdAt: "2026-10-14T00:00:00.000Z", effectiveAt: null, approvedAt: null, approvedBy: null, legalReviewReference: null } as const;
export const digitalMusicTermsDraft = draft({ ...common, type: "DIGITAL_MUSIC_TERMS", version: DIGITAL_MUSIC_TERMS_DRAFT_VERSION,
  title: "Conditions de vente de musique numérique catalogue — brouillon de revue DCN",
  sections: [
    { title: "Document distinct et portée", paragraphs: [
      "BROUILLON QA, NON APPROUVÉ POUR LIVE. Ces propositions concernent uniquement les achats de musique catalogue téléchargeable par des particuliers. Elles ne remplacent aucun document des créations personnalisées, de la Boutique physique, des licences Rights ou du soutien.",
      "Le vendeur reste Ludovic Mickaël Mathon, entreprise individuelle LNX Beats, SIRET 10687085000018. Identité et coordonnées professionnelles : référentiel de mentions légales existant. Aucune nouvelle société ni nouvelle adhésion à un médiateur n’est créée.",
      "Le catalogue peut être visible dans un territoire autorisé à la présentation. Un paiement n’est possible que pour les pays et subdivisions expressément approuvés dans le registre fiscal, juridique, de droits musicaux et de paiement. L’ambition internationale n’ouvre pas tous les pays automatiquement." ] },
    { title: "Contenu, formats et compatibilité", paragraphs: [
      "Un achat donne accès, sans supplément de format, au WAV et au MP3 du contenu effectivement acquis. Un album comprend un ZIP WAV et un ZIP MP3 séparés, ainsi que les fichiers individuels des pistes figées dans sa composition au moment de l’achat.",
      "Les extraits publics de chaque piste sont des fichiers distincts de 60 secondes maximum. Ils ne constituent pas le fichier complet privé. La fiche indique les formats disponibles et les caractéristiques nécessaires à leur lecture et au téléchargement.",
      "La vente d’un inédit n’exige pas une diffusion préalable sur une plateforme de streaming ; les droits nécessaires sur œuvres, masters, samples et interventions doivent cependant avoir été validés." ] },
    { title: "Compte, panier et prix", paragraphs: [
      "Le parcours numérique exige un compte actif et une adresse e-mail vérifiée. Son panier est distinct du panier physique et ne crée aucune livraison ni gestion de stock physique.",
      "Les prix de chaque piste et de chaque album sont fixés indépendamment en euros par l’éditeur. Tous les prix affichés dans cette démonstration sont fictifs et ne constituent pas des tarifs de lancement. Le serveur revalide le contenu, le prix, le crédit éventuel et les taxes applicables avant le paiement.",
      "Le client particulier fournit les informations territoriales nécessaires. Une incohérence entre résidence et facturation, une subdivision manquante ou une règle non approuvée bloque le paiement et nécessite correction ou revue. Le parcours DCN ne traite pas un achat professionnel." ] },
    { title: "Compléter un album", paragraphs: [
      "Le prix de complément tient compte uniquement des titres admissibles acquis individuellement, selon les sommes effectivement payées et non remboursées qui leur sont attribuables. Une piste canonique ne peut être déduite plusieurs fois ; le crédit ne dépasse jamais le prix de l’album.",
      "Le devis présente le prix album, les acquisitions prises en compte, les crédits tracés, la somme restant due et la fiscalité approuvée. Il est revalidé en cas de modification du prix, du catalogue, d’un remboursement, d’un litige ou d’un autre achat concurrent. La facture d’un ancien single n’est ni réécrite ni annulée par un avoir automatique.",
      "Un complément à zéro, une promotion complexe, un cadeau, un bundle, une version ou édition incompatible et le remboursement d’une source de crédit déjà utilisée nécessitent une décision explicite ; à défaut le parcours reste bloqué pour revue." ] },
    { title: "Paiement, confirmation et commencement", paragraphs: [
      "Le paiement doit être confirmé côté serveur par le prestataire, avec montant, devise, compte marchand et références concordants. Une URL de succès ou une simple approbation navigateur ne prouve aucun paiement et n’accorde aucun fichier.",
      "La confirmation sur support durable conserve le contenu, les versions acquises, les conditions exactes, les consentements distincts, le montant et les documents applicables. Le mécanisme de remise et de commencement doit être approuvé juridiquement avant LIVE.",
      DIGITAL_MUSIC_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_MUSIC_WITHDRAWAL_DRAFT,
      "La perte éventuelle du droit de rétractation n’est pas automatique du seul fait du paiement et n’efface aucune garantie légale. Les délais, exceptions et modalités de rétractation en ligne applicables au territoire doivent être validés avant son ouverture." ] },
    { title: "Licence personnelle proposée", paragraphs: [
      "Licence proposée pour écoute personnelle et conservation des fichiers acquis, sans cession de droits d’exploitation, de publication, de distribution, de synchronisation ou de monétisation. Le texte définitif et sa compatibilité avec les droits impératifs du consommateur restent soumis à revue.",
      "Aucune licence Rights ni avantage de soutien n’est inclus implicitement. Le téléchargement ne transfère pas la propriété intellectuelle de l’œuvre ou du master." ] },
    { title: "Versions et accès", paragraphs: [
      "Les versions originales effectivement achetées sont conservées indépendamment d’un remplacement de master ou d’une évolution de la composition du catalogue. Une nouvelle édition ou un remaster n’est pas ajouté automatiquement ; les corrections nécessaires à la conformité légale sont traitées séparément.",
      "Le re-téléchargement n’a pas de limite arbitraire tant que le service fonctionne et que les droits restent actifs. Les liens temporaires, contrôles propriétaire et limitations de sécurité peuvent être renouvelés. Aucune promesse d’hébergement perpétuel n’est formulée.",
      "Les conséquences d’une fin de service, d’un incident, d’une suspension justifiée ou de l’indisponibilité d’un format doivent préserver les droits impératifs et être explicitées dans le texte approuvé." ] },
    { title: "Conformité, remboursements et litiges", paragraphs: [
      "Les garanties légales du contenu numérique et les recours applicables demeurent préservés. Le service prévoit un contact pour défaut, indisponibilité, demande de correction ou remboursement, sans clause absolue de non-remboursement.",
      "Tout remboursement confirmé conserve la facture originale et produit un avoir distinct avec montant, motif et référence. Une réduction de prix peut conserver les droits ; une résolution peut retirer les droits concernés selon la politique approuvée. Les preuves, acquisitions et documents historiques ne sont pas supprimés.",
      "Les contestations de paiement et contradictions financières sont examinées avant attribution ou réactivation de droits. Aucun remboursement, recapture ou e-mail rétroactif n’est déclenché automatiquement pour masquer une incohérence." ] },
    { title: "Réclamation et médiation existante", paragraphs: [
      "Adresser d’abord une réclamation au contact professionnel LNX Beats mentionné dans les mentions légales.",
      `En cas de désaccord persistant et lorsque la médiation est applicable, le consommateur peut saisir gratuitement ${mediator.name}, ${mediator.addressLines.join(", ")} — ${mediator.phone} — ${mediator.website}. CM2C est déjà désigné ; aucune nouvelle adhésion n’est demandée.`,
      "La portée de la convention existante pour ce nouveau commerce numérique et les recours des consommateurs hors France restent à vérifier. Aucune compétence ou règle territoriale impérative n’est écartée par ce brouillon." ] },
    { title: "Fiscalité et justificatifs", paragraphs: [
      "Le régime spécial BNC/micro-BNC et la franchise française appliquée aux opérations historiques sont connus. Ils ne prouvent pas automatiquement la qualification ni la TVA du nouveau téléchargement mondial.",
      "Chaque territoire nécessite une règle approuvée avec base légale, éventuelles immatriculations, taux ou exemption justifiée, calcul, conservation et règles d’avoir. Aucune mention française article 293 B ou TVA zéro n’est appliquée par défaut à une vente étrangère.",
      "Les factures, confirmations contractuelles et avoirs restent distincts ; ils tracent montant brut, taxe approuvée, crédit album, paiements, remboursements et frais connus du prestataire sans assimiler le net encaissé au prix initial." ] },
  ], reviewRequired: ["DIGITAL_LICENSE_WORDING", "IMMEDIATE_SUPPLY_DURABLE_CONFIRMATION", "WITHDRAWAL_ONLINE_AND_TERRITORIAL_RULES", "DIGITAL_CONFORMITY_AND_END_OF_SERVICE",
    "CM2C_EXISTING_CONVENTION_DIGITAL_SCOPE", "DCN_FRENCH_ACTIVITY_AND_VAT_QUALIFICATION", "COUNTRY_AND_SUBDIVISION_TAX_RULES", "COMPLETION_ZERO_AND_COMPLEX_CREDITS"] });
export const DIGITAL_MUSIC_TERMS_DRAFT_TEXT = digitalMusicTermsDraft.sections.map(s => `${s.title}\n${s.paragraphs.join("\n")}`).join("\n\n");
export const DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH = createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex");

export const digitalPrivacyAddendumDraft = draft({ ...common, type: "DIGITAL_PRIVACY_ADDENDUM", version: "digital-privacy-addendum-20261014-draft-01",
  title: "Complément ciblé de confidentialité DCN — brouillon", sections: [
    { title: "Portée séparée", paragraphs: ["Cet ajout proposé concerne uniquement le nouveau commerce numérique. La notice approuvée existante, ses versions et preuves historiques sont conservées sans modification."] },
    { title: "Données nécessaires", paragraphs: ["Compte vérifié, pays de résidence et de facturation, subdivision requise, indices prestataire strictement nécessaires, commandes et versions acquises, consentements et remise durable, factures/avoirs, journal de sécurité et téléchargements autorisés. Pas de décision IP-only ni de profilage géographique inutile."] },
    { title: "Finalités, destinataires et conservation", paragraphs: ["Contrat, délivrance, justification comptable/fiscale, conformité et sécurité des fichiers privés. Stripe et PayPal restent des prestataires de paiement, non des Merchant of Record automatiquement. R2 et le transport d’e-mails existant sont réutilisés selon leur configuration autorisée.",
      "La base juridique, les durées par catégorie, les éventuels registres OSS/SME, les transferts et garanties internationales ainsi que l’exercice des droits doivent être validés pour les territoires ouverts. Ce brouillon ne fixe aucun délai de conservation nouveau ni consentement marketing implicite."] },
  ], reviewRequired: ["DCN_DATA_RETENTION_AND_TAX_EVIDENCE", "INTERNATIONAL_TRANSFERS", "DCN_PRIVACY_WORDING"] });

/** Proof references only: no approval, activation or alteration of these historical documents. */
export const existingLegalProofReferences = Object.freeze(approvedLegalDocuments.map(document => Object.freeze({ type: document.type,
  version: document.version, hashSha256: document.hashSha256, approvedAt: document.approvedAt, effectiveAt: document.effectiveAt })));

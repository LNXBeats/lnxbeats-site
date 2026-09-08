export const contractPlaceholderNames = [
  "contractNumber",
  "generatedDate",
  "orderNumber",
  "requestNumber",
  "workTitle",
  "clientName",
  "clientAddress",
  "artistName",
  "lnxIdentity",
  "platforms",
  "territory",
  "duration",
  "price",
  "rightsMatrix",
  "proposedSplit",
] as const;

export type ContractPlaceholderName = (typeof contractPlaceholderNames)[number];

const allowed = new Set<string>(contractPlaceholderNames);
const placeholderPattern = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

export function templatePlaceholders(source: string) {
  return [...source.matchAll(placeholderPattern)].map((match) => match[1] ?? "");
}

export function validateContractTemplate(source: string) {
  if (!source || source.length > 80_000) return { ok: false, code: "INVALID_TEMPLATE" } as const;
  if (/<\s*(script|iframe|object|embed|link|style)\b/i.test(source)) return { ok: false, code: "UNSAFE_MARKUP" } as const;
  if (/\{[%#]|<%|\$\{|process\.env|require\s*\(|import\s*\(/i.test(source)) return { ok: false, code: "UNSAFE_EXPRESSION" } as const;
  const unknown = templatePlaceholders(source).find((name) => !allowed.has(name));
  if (unknown) return { ok: false, code: "UNKNOWN_PLACEHOLDER", placeholder: unknown } as const;
  return { ok: true } as const;
}

function escapePlainText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderContractTemplate(source: string, values: Record<ContractPlaceholderName, string>) {
  const validity = validateContractTemplate(source);
  if (!validity.ok) throw new Error(`Contract template rejected: ${validity.code}`);
  return source.replace(placeholderPattern, (_, name: string) => escapePlainText(values[name as ContractPlaceholderName]));
}

export const publicationLicenseDraftTemplate = `
# CONDITIONS PARTICULIÈRES — LICENCE DE PUBLICATION VIA DISTRIBUTEUR

Contrat : {{contractNumber}}
Version générée le {{generatedDate}}
Commande : {{orderNumber}}
Demande : {{requestNumber}}

## Parties
LNX Beats : {{lnxIdentity}}
Client : {{clientName}}
Adresse : {{clientAddress}}

## Œuvre concernée
Titre : {{workTitle}}
Nom d’artiste : {{artistName}}

## Objet
La présente licence porte exclusivement sur l’œuvre identifiée ci-dessus. Elle autorise, dans les limites du présent contrat, sa reproduction, sa distribution et sa communication au public strictement nécessaires à sa publication par le client via un distributeur numérique, sur les plateformes de streaming et de téléchargement desservies par ce distributeur.

## Droits expressément accordés
{{rightsMatrix}}

Plateformes et supports : {{platforms}}
Territoire : monde entier
Durée : cinq ans à compter de la prise d’effet
Prix unique : {{price}}

La licence est non exclusive. Elle n’emporte aucune cession complète de propriété intellectuelle et ne porte pas atteinte aux droits moraux légalement attachés à l’œuvre. Le client ne peut ni transférer ni revendre la licence. Une sous-licence est permise uniquement dans la mesure techniquement nécessaire au distributeur choisi, pour la durée et le périmètre de la licence.

Toute adaptation substantielle nécessite un accord écrit distinct de LNX Beats. Aucun Content ID exclusif ni aucune revendication portant atteinte aux droits de LNX Beats n’est autorisé sans accord écrit. Le client crédite LNX Beats selon le rôle réellement prévu dans l’œuvre et veille à l’exactitude des métadonnées transmises au distributeur.

## Obligations et garanties
Le client garantit disposer des droits nécessaires sur les éléments, visuels, noms, marques et métadonnées qu’il ajoute à la publication. Il respecte les conditions du distributeur et des plateformes et n’accorde pas à un tiers plus de droits que ceux prévus au présent contrat.

LNX Beats garantit seulement être habilité à consentir les droits expressément accordés au titre de ses propres contributions. LNX Beats ne garantit ni l’acceptation de la publication par un distributeur ou une plateforme, ni un référencement, ni un volume d’écoute, ni un revenu.

## Prise d’effet
La licence ne prend effet qu’après paiement confirmé du prix de 150,00 EUR, acceptation conservée, génération valide du document contractuel final et expiration du délai légal de rétractation. Un projet, une acceptation incomplète ou un paiement incomplet n’accorde aucun droit.

Aucun commencement anticipé n’est automatique. S’il est proposé ultérieurement, il exige une demande expresse distincte du client, sans case précochée, ainsi que la reconnaissance distincte des conséquences légales applicables. Ces preuves doivent être conservées sur un support durable.

## Rétractation, retrait et fin de la licence
Le consommateur dispose du délai légal de rétractation applicable aux contrats conclus à distance. La fonctionnalité en ligne de rétractation et les coordonnées de contact sont celles publiées par LNX STUDIO. L’exercice d’un droit légal ne peut être neutralisé par une clause du présent contrat.

À l’expiration normale de la licence, ou après sa résolution dans les conditions légalement applicables, le client cesse les nouvelles exploitations et demande dans un délai raisonnable le retrait de la publication à son distributeur. Les copies, délais de cache et traitements déjà engagés par des plateformes tierces peuvent subsister pendant leur délai technique normal.

En cas de manquement suffisamment grave, la partie concernée peut demander la résolution après une mise en demeure écrite restée sans effet pendant trente jours, sauf urgence ou règle impérative permettant une mesure plus rapide. Les conséquences financières et les éventuels remboursements restent soumis aux règles légales applicables et à la situation effectivement exécutée.

## Responsabilité, droit applicable et litiges
Chaque partie répond de ses propres obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie ou d’un recours impératif. Les informations personnelles sont traitées selon la politique de confidentialité publiée par LNX STUDIO.

Le contrat est soumis au droit français, sans priver le consommateur des protections impératives dont il bénéficie. Une réclamation préalable peut être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le médiateur indiqué dans les mentions légales, sans préjudice de son droit de saisir la juridiction compétente.

Les droits non expressément accordés restent non accordés. LNX Beats conserve les droits correspondant à ses contributions créatives. La licence ne garantit ni acceptation par un distributeur, ni succès commercial, ni revenu minimum, ni validation ou revenu SACEM, ni Content ID, ni placement éditorial.

STATUT : PROJET — NON ACTIF — VALIDATION JURIDIQUE EXTERNE REQUISE. Les clauses de rétractation, commencement anticipé, résolution, retrait, responsabilité et règlement des litiges doivent être approuvées dans une revue juridique référencée avant toute approbation du modèle et toute ouverture commerciale.
`;

export const exploitationPartnershipDraftTemplate = `
# CONDITIONS PARTICULIÈRES DE PARTENARIAT - PROJET

Contrat : {{contractNumber}}
Version générée le {{generatedDate}}
Commande : {{orderNumber}}
Demande : {{requestNumber}}

## Parties et œuvre
LNX Beats : {{lnxIdentity}}
Client : {{clientName}} - {{clientAddress}}
Œuvre : {{workTitle}}
Nom d’artiste : {{artistName}}

## Contributions et rôles proposés
{{rightsMatrix}}

## Proposition commerciale entre parties
{{proposedSplit}}

Cette proposition n’est pas automatiquement une clé de répartition SACEM. Les rôles, catégories de droits, contributions et règles applicables doivent être vérifiés. Elle ne garantit ni déclaration ni répartition.

Territoire envisagé : {{territory}}
Durée envisagée : {{duration}}
Plateformes et supports : {{platforms}}
Montant cible futur : {{price}}

Sections à finaliser après étude et revue juridique : historique, contributions retenues, rôles, droits, exploitation, rémunération, gestion collective, obligations déclaratives, crédits, métadonnées, modifications, reddition d’informations, résiliation, litiges et acceptations.
`;

export const sacemPreparationDraftTemplate = `
# FICHE DE PRÉPARATION - DÉCLARATION ÉVENTUELLE

Demande : {{requestNumber}}
Commande : {{orderNumber}}
Œuvre : {{workTitle}}
Rôles et contributions envisagés : {{rightsMatrix}}
Proposition contractuelle : {{proposedSplit}}

CE DOCUMENT N’EST PAS UNE DÉCLARATION SACEM. IL RESTE PRIVÉ, NE VAUT PAS DÉCISION D’ÉLIGIBILITÉ ET N’EST TRANSMIS AUTOMATIQUEMENT À AUCUN ORGANISME.
`;

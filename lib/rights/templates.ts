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
# CONDITIONS PARTICULIÈRES - PROJET

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

## Objet et droits expressément envisagés
{{rightsMatrix}}

Plateformes et supports : {{platforms}}
Territoire : {{territory}}
Durée : {{duration}}
Montant cible futur : {{price}}

Les droits non expressément accordés restent non accordés. Ce projet n’emporte ni transfert de la qualité d’auteur, ni attribution automatique d’une quote-part auprès de la SACEM ou d’une autre société de gestion collective. LNX Beats conserve les droits correspondant à ses contributions créatives. Le client déclare sincèrement ses propres contributions.

Sections à finaliser après revue juridique : exclusivité, rémunération, crédits, modifications, Content ID, garanties, résiliation, droit applicable, rétractation et preuve d’acceptation.
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

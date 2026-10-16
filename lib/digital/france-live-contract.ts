import { createHash } from "node:crypto";
import {
  digitalFranceTermsDraft,
  DIGITAL_FRANCE_TERMS_TEXT_HASH,
  DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT,
  DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT,
} from "@/lib/digital/france-legal";

/** Candidate only. Importing this module never approves a contract, tax rule or sale. */
export const DIGITAL_FRANCE_LIVE_CONTRACT_VERSION = "digital-music-france-cgv-20261016-draft-04";
export const DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE = "FR_METROPOLITAN_CORSICA_B2C";
export type DigitalFranceContractSection = { title: string; paragraphs: readonly string[]; boxed?: boolean };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function canonical(value: unknown): unknown {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
}
export const digitalFranceContractHash = (value: unknown) => sha(JSON.stringify(canonical(value)));
const replacements = [
  [digitalFranceTermsDraft.sections[0].paragraphs[0], "Ces conditions régissent la vente de titres et d’albums du catalogue musical par téléchargement à des particuliers. Elles ne remplacent pas les conditions des créations sur commande, de la Boutique physique, des licences d’exploitation ou du soutien."],
  [digitalFranceTermsDraft.sections[1].paragraphs[0], "Les ventes de téléchargements musicaux sont proposées aux particuliers résidant et facturés en France métropolitaine, Corse comprise. Les marchés d’outre-mer, étrangers et professionnels ne sont pas ouverts par ces conditions. FR-MET est un code de marché interne, pas un code pays officiel."],
  [digitalFranceTermsDraft.sections[1].paragraphs[1], "Cette limitation commerciale ne dispense pas du respect des règles impératives françaises et européennes applicables. L’éligibilité est examinée à partir des informations de résidence et de facturation nécessaires, sans déduire la résidence de la seule nationalité, adresse IP ou origine de la carte bancaire."],
  [digitalFranceTermsDraft.sections[3].paragraphs[1], "Les prix de chaque titre et de chaque album sont fixés par LNX Beats, indépendamment les uns des autres, et indiqués en euros sur les fiches et dans le récapitulatif avant paiement. Le client ne choisit pas un montant libre : il accepte le prix récapitulé. Chaque titre inclut ses formats WAV et MP3 sans supplément."],
  [digitalFranceTermsDraft.sections[3].paragraphs[2], "Avant de confirmer la commande avec obligation de paiement, le client peut vérifier et corriger son panier. Le récapitulatif indique le total en euros, le crédit de complément éventuel et le traitement fiscal effectivement applicable à la commande. Les mentions fiscales et les montants sont conservés dans les justificatifs émis."],
  [digitalFranceTermsDraft.sections[5].paragraphs[2], "La fourniture immédiate n’est engagée qu’après le recueil séparé des choix requis et la remise de leur confirmation durable. L’accès aux fichiers est accordé dans la bibliothèque après les contrôles serveur et le commencement de la fourniture. Le seul paiement ou l’acceptation des conditions ne suffit pas à faire perdre le droit de rétractation."],
  [digitalFranceTermsDraft.sections[6].paragraphs[2], "Le client peut adresser une déclaration non ambiguë au contact postal ou électronique du vendeur, en identifiant le contrat et son nom. Il peut utiliser le modèle joint, sans y être obligé. La fonctionnalité sans frais à /retractation permet de choisir un achat numérique, de relire et corriger la déclaration puis de confirmer expressément la rétractation ; elle ne requiert pas de connexion ni de motif. L’accusé téléchargeable conserve son contenu et la date et l’heure UTC de réception."],
  [digitalFranceTermsDraft.sections[7].paragraphs[0], "La licence retenue par LNX Beats autorise exclusivement l’écoute, le téléchargement et la conservation des fichiers acquis pour un usage privé. Elle n’autorise aucune diffusion publique, redistribution, publication, synchronisation, monétisation ou exploitation commerciale. Ces utilisations nécessitent des autorisations spécifiques séparées. Aucun droit d’auteur ou droit voisin n’est cédé. Les usages et droits résultant de dispositions impératives restent préservés."],
  [digitalFranceTermsDraft.sections[7].paragraphs[2], "Les liens privés temporaires peuvent être renouvelés ; tant que le service de bibliothèque fonctionne et que les droits concernés restent actifs, aucune limite arbitraire du nombre de re-téléchargements n’est imposée. Le client est invité à conserver ses fichiers. Il n’est pas promis un hébergement perpétuel ; une fin de service doit préserver les droits impératifs."],
  [digitalFranceTermsDraft.sections[10].paragraphs[0], "Une réclamation préalable peut être adressée aux coordonnées professionnelles indiquées ci-dessus. Le consommateur conserve ses recours judiciaires et les protections impératives applicables ; aucune compétence exclusive au siège du vendeur n’est imposée par ces conditions."],
  [digitalFranceTermsDraft.sections[10].paragraphs[2], "CM2C est déjà le médiateur désigné de LNX Beats. Dans le cadre de la convention existante, CM2C a confirmé le 15 octobre 2026 la couverture des activités liées au SIRET 10687085000018, à la suite de la demande relative à la vente directe de téléchargements musicaux. Aucune nouvelle adhésion n’est proposée. Cette confirmation de couverture ne constitue pas une approbation juridique des présentes conditions. Aucune ancienne plateforme européenne de règlement en ligne devenue indisponible n’est présentée comme un recours actuel."],
] as const;
const sections: readonly DigitalFranceContractSection[] = Object.freeze(digitalFranceTermsDraft.sections.map(section => Object.freeze({
  title: section.title, paragraphs: Object.freeze(section.paragraphs.map(paragraph => replacements.find(([before]) => before === paragraph)?.[1] ?? paragraph)),
  ...("boxed" in section ? { boxed: section.boxed } : {}),
})));
for (const [before] of replacements) if (digitalFranceTermsDraft.sections.flatMap(section => section.paragraphs).filter(paragraph => paragraph === before).length !== 1) throw new Error("FROZEN_FRANCE_02_SOURCE_CHANGED");
export const DIGITAL_FRANCE_LIVE_CONTRACT_TEXT = sections.map(section => `${section.title}\n${section.paragraphs.join("\n")}`).join("\n\n");
export const DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH = sha(DIGITAL_FRANCE_LIVE_CONTRACT_TEXT);
export const DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS = Object.freeze({
  immediateSupply: DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT,
  withdrawalAcknowledgement: DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT,
});
export const DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH = digitalFranceContractHash(DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS);
const payload = Object.freeze({
  type: "DIGITAL_MUSIC_TERMS_FRANCE" as const,
  version: DIGITAL_FRANCE_LIVE_CONTRACT_VERSION, title: "Conditions de vente de musique numérique — France métropolitaine et Corse",
  status: "DRAFT" as const, approvedForLive: false, approvedAt: null, approvedBy: null,
  scope: DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE, sections,
  textHashSha256: DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH, consents: DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS,
  consentsHashSha256: DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH,
  previousVersion: digitalFranceTermsDraft.version, previousDocumentHashSha256: digitalFranceTermsDraft.hashSha256,
  previousTextHashSha256: DIGITAL_FRANCE_TERMS_TEXT_HASH,
  fiscalMentionPolicy: "EXACT_APPROVED_LIVE_RULE_SNAPSHOT_REQUIRED" as const,
});
export const digitalFranceLiveContractCandidate = Object.freeze({ ...payload, hashSha256: digitalFranceContractHash(payload) });

export type DigitalFranceLiveContractApprover = { id: string; role: string; status: string; emailVerified: boolean };
export type DigitalFranceLiveContractApproval = {
  id: string; kind: "DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL"; status: "APPROVED" | "REVOKED";
  version: string; documentHashSha256: string; textHashSha256: string; consentsHashSha256: string;
  scope: string; approvedAt: string; approvedBy: string; evidenceReference: string; evidenceSha256: string;
  createdAt: string; recordHash: string;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const canonicalDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function digitalFranceLiveContractApprovalHash(record: Omit<DigitalFranceLiveContractApproval, "recordHash">) { return digitalFranceContractHash(record); }
function approvalIdentity(record: DigitalFranceLiveContractApproval | null, at: Date) {
  if (!record || !Number.isFinite(at.getTime()) || record.kind !== "DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL" || record.status !== "APPROVED"
    || !uuid(record.id) || !uuid(record.approvedBy) || record.version !== DIGITAL_FRANCE_LIVE_CONTRACT_VERSION
    || record.documentHashSha256 !== digitalFranceLiveContractCandidate.hashSha256 || record.textHashSha256 !== DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH
    || record.consentsHashSha256 !== DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH || record.scope !== DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE
    || !canonicalDate(record.approvedAt) || !canonicalDate(record.createdAt) || Date.parse(record.approvedAt) > Date.parse(record.createdAt)
    || Date.parse(record.createdAt) > at.getTime() || !/^private-evidence:[A-Za-z0-9][A-Za-z0-9._/-]{0,179}$/.test(record.evidenceReference ?? "")
    || record.evidenceReference.includes("..") || !/^[a-f0-9]{64}$/.test(record.evidenceSha256 ?? "")) return false;
  const { recordHash, ...details } = record;
  return recordHash === digitalFranceLiveContractApprovalHash(details);
}
/** For NEW commitments only. Record and current actor must be freshly loaded by the server.
 * JSON supplied by a browser, or a bare true, is never an approval repository. */
export function assessDigitalFranceLiveContractApproval(record: DigitalFranceLiveContractApproval | null, currentActor: DigitalFranceLiveContractApprover | null, now = new Date()) {
  return approvalIdentity(record, now) && !!currentActor && currentActor.id === record!.approvedBy
    && currentActor.role === "ADMIN" && currentActor.status === "ACTIVE" && currentActor.emailVerified === true;
}
export type DigitalFranceLiveContractApprovalSnapshot = { policy: "DCN_FR_LIVE_CONTRACT_APPROVAL_SNAPSHOT_1"; capturedAt: string;
  approval: DigitalFranceLiveContractApproval; actorVerifiedAtCapture: true; snapshotHash: string };
export function snapshotDigitalFranceLiveContractApproval(record: DigitalFranceLiveContractApproval | null, currentActor: DigitalFranceLiveContractApprover | null, now = new Date()): DigitalFranceLiveContractApprovalSnapshot {
  if (!assessDigitalFranceLiveContractApproval(record, currentActor, now)) throw new Error("FR_LIVE_CONTRACT_APPROVAL_REQUIRED");
  const body = { policy: "DCN_FR_LIVE_CONTRACT_APPROVAL_SNAPSHOT_1" as const, capturedAt: now.toISOString(), approval: { ...record! }, actorVerifiedAtCapture: true as const };
  return { ...body, snapshotHash: digitalFranceContractHash(body) };
}
/** Historical immutable order/contract snapshots are checked on their acquired version,
 * not today's actor status or latest approval. No retroactive invalidation on revocation. */
export function validateSavedDigitalFranceLiveContractApproval(snapshot: DigitalFranceLiveContractApprovalSnapshot | null) {
  if (!snapshot || snapshot.policy !== "DCN_FR_LIVE_CONTRACT_APPROVAL_SNAPSHOT_1" || snapshot.actorVerifiedAtCapture !== true || !canonicalDate(snapshot.capturedAt)
    || !approvalIdentity(snapshot.approval, new Date(snapshot.capturedAt))) return false;
  const { snapshotHash, ...body } = snapshot;
  return snapshotHash === digitalFranceContractHash(body);
}
/** Explicit registry lookup: future versions must ADD an immutable entry, never replace it. */
export function digitalFranceLiveContractByVersion(version: string) {
  return version === DIGITAL_FRANCE_LIVE_CONTRACT_VERSION ? digitalFranceLiveContractCandidate : null;
}

import { billingSnapshotHash,validateBillingCustomerIdentity } from "@/lib/billing/domain";
import { createHash } from "node:crypto";
import { DIGITAL_EARLY_DELIVERY_TEXT, DIGITAL_WITHDRAWAL_TEXT, DIGITAL_TERMS_VERSION, DigitalError } from "./domain";
import { DIGITAL_MUSIC_TERMS_DRAFT_TEXT } from "./digital-legal";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT, DIGITAL_FRANCE_TERMS_TEXT_HASH,
  DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT, digitalFranceTermsDraft } from "./france-legal";
import { digitalFranceLiveContractByVersion, DIGITAL_FRANCE_LIVE_CONTRACT_VERSION,
  validateSavedDigitalFranceLiveContractApproval, type DigitalFranceLiveContractApprovalSnapshot } from "./france-live-contract";
import type { DigitalMode } from "./runtime-policy";
import { normalizeDigitalFranceResidenceAddress, type DigitalFranceMinimalAddress } from "./france-residence-v2-policy";

export const DIGITAL_FISCAL_REVIEW_NOTICE = "TEST : fiscalité des contenus numériques à valider. Aucun régime ni taux réel présumé.";
export const DIGITAL_CONTRACT_POLICY = "DCN-CONSOLIDATION-QA-EXPLICIT-RECEIPT";
export const DIGITAL_FRANCE_CONTRACT_POLICY = "DCN-FRANCE-QA-EXPLICIT-RECEIPT-1";
export const DIGITAL_FRANCE_LIVE_CONTRACT_POLICY = "DCN-FRANCE-LIVE-EXPLICIT-RECEIPT-1";
/** Immutable version lookup. Lookup alone never authorizes a LIVE commitment. */
export function digitalContractTerms(termsVersion: string) {
  const live = digitalFranceLiveContractByVersion(termsVersion);
  if (live) return Object.freeze({version:live.version,text:live.sections.map(s=>`${s.title}\n${s.paragraphs.join("\n")}`).join("\n\n"),
    hash:live.textHashSha256,earlyDeliveryText:live.consents.immediateSupply,withdrawalText:live.consents.withdrawalAcknowledgement});
  // Published QA candidates are immutable. A future France version must add a
  // registry entry and retain this version, texts, sections and hashes for receipt
  // verification; never repoint an acquired version at a new template.
  if (termsVersion === DIGITAL_FRANCE_TERMS_VERSION) return Object.freeze({ version: termsVersion, text: DIGITAL_FRANCE_TERMS_TEXT,
    hash: DIGITAL_FRANCE_TERMS_TEXT_HASH, earlyDeliveryText: DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, withdrawalText: DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT });
  if (termsVersion !== DIGITAL_TERMS_VERSION) throw new DigitalError("CONTRACT_REQUIRES_REVIEW", 409);
  return Object.freeze({ version: termsVersion, text: DIGITAL_MUSIC_TERMS_DRAFT_TEXT,
    hash: createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex"), earlyDeliveryText: DIGITAL_EARLY_DELIVERY_TEXT, withdrawalText: DIGITAL_WITHDRAWAL_TEXT });
}
type ContractSnapshot = {
  mode: string; policy: string; customer: { type: string; name: string; email: string; billingAddress?:DigitalFranceMinimalAddress }; acceptedAt: string;
  terms: { version: string; text: string; hashSha256?: string; documentHashSha256?: string; status?: string; expresslyAccepted?: boolean;
    sections?: ReadonlyArray<{ title: string; paragraphs: readonly string[]; boxed?: boolean }> };
  earlyDelivery: { expresslyRequested: boolean; text: string }; withdrawal: { expresslyAcknowledged: boolean; text: string };
  licenseStatus: string; fiscalStatus: string; approvedForLive?: boolean; liveApproval?: DigitalFranceLiveContractApprovalSnapshot;
  billingAddressSource?:"BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE";
};
export function digitalContractSnapshot(customer: { email: string; name: string; billingAddress?:DigitalFranceMinimalAddress;billingAddressConfirmedAsResidence?:boolean }, acceptedAt: Date, termsVersion = DIGITAL_TERMS_VERSION,
  options?:{mode:DigitalMode;approval?:DigitalFranceLiveContractApprovalSnapshot}): ContractSnapshot {
  if(options?.mode==="LIVE"){
    const document=digitalFranceLiveContractByVersion(termsVersion),approval=options.approval;
    if(!document||!approval||!validateSavedDigitalFranceLiveContractApproval(approval)
      ||approval.approval.version!==termsVersion||Date.parse(approval.capturedAt)>acceptedAt.getTime())throw new DigitalError("FR_LIVE_CONTRACT_APPROVAL_REQUIRED",409);
    const billingAddress=normalizeDigitalFranceResidenceAddress(customer.billingAddress);
    if(customer.billingAddressConfirmedAsResidence!==true)throw new DigitalError("FRANCE_BILLING_ADDRESS_REQUIRED",409);
    let identity;try{identity=validateBillingCustomerIdentity({type:"INDIVIDUAL",name:customer.name,email:customer.email,billingAddress});}
    catch{throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);}
    return{mode:"LIVE",policy:DIGITAL_FRANCE_LIVE_CONTRACT_POLICY,customer:{type:"INDIVIDUAL",name:identity.name,email:identity.email,billingAddress},billingAddressSource:"BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE",
      acceptedAt:acceptedAt.toISOString(),terms:{version:document.version,text:digitalContractTerms(termsVersion).text,hashSha256:document.textHashSha256,
        documentHashSha256:document.hashSha256,status:"APPROVED",expresslyAccepted:true,sections:document.sections},
      earlyDelivery:{expresslyRequested:true,text:document.consents.immediateSupply},
      withdrawal:{expresslyAcknowledged:true,text:document.consents.withdrawalAcknowledgement},
      approvedForLive:true,liveApproval:approval,licenseStatus:"PERSONAL_PRIVATE_USE",fiscalStatus:"APPROVED_TERRITORY_SNAPSHOT"};
  }
  if(termsVersion===DIGITAL_FRANCE_LIVE_CONTRACT_VERSION)throw new DigitalError("FR_LIVE_CONTRACT_APPROVAL_REQUIRED",409);
  const terms = digitalContractTerms(termsVersion), france = termsVersion === DIGITAL_FRANCE_TERMS_VERSION;
  return { mode: "TEST", policy: france ? DIGITAL_FRANCE_CONTRACT_POLICY : DIGITAL_CONTRACT_POLICY, customer: { type: "INDIVIDUAL", name: customer.name, email: customer.email },
    acceptedAt: acceptedAt.toISOString(), terms: { version: terms.version, text: terms.text,
      ...(france ? { hashSha256: terms.hash, documentHashSha256: digitalFranceTermsDraft.hashSha256, status: "DRAFT", expresslyAccepted: true, sections: digitalFranceTermsDraft.sections } : {}) },
    earlyDelivery: { expresslyRequested: true, text: terms.earlyDeliveryText },
    withdrawal: { expresslyAcknowledged: true, text: terms.withdrawalText },
    ...(france ? { approvedForLive: false as const } : {}),
    licenseStatus: "PROPOSED_NOT_LIVE_APPROVED", fiscalStatus: "LOCAL_REVIEW_ONLY" };
}
export function verifyContractSnapshot(snapshot: unknown, termsVersion: string, termsHash: string) {
  const s = snapshot as ReturnType<typeof digitalContractSnapshot>;
  if(s?.mode==="LIVE"){
    const document=digitalFranceLiveContractByVersion(termsVersion),exact=digitalContractTerms(termsVersion);
    if(!document||s.policy!==DIGITAL_FRANCE_LIVE_CONTRACT_POLICY)throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);
    let billingAddress,identity;
    try{billingAddress=normalizeDigitalFranceResidenceAddress(s.customer?.billingAddress);identity=validateBillingCustomerIdentity(s.customer as Parameters<typeof validateBillingCustomerIdentity>[0]);}catch{throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);}
    if(!document||s.policy!==DIGITAL_FRANCE_LIVE_CONTRACT_POLICY||s.terms?.version!==termsVersion
      ||s.terms.text!==exact.text||termsHash!==exact.hash||s.terms.hashSha256!==exact.hash||s.terms.documentHashSha256!==document.hashSha256
      ||s.terms.status!=="APPROVED"||s.terms.expresslyAccepted!==true||billingSnapshotHash(s.terms.sections)!==billingSnapshotHash(document.sections)
      ||s.earlyDelivery?.expresslyRequested!==true||s.earlyDelivery.text!==exact.earlyDeliveryText
      ||s.withdrawal?.expresslyAcknowledged!==true||s.withdrawal.text!==exact.withdrawalText
      ||s.approvedForLive!==true||!s.liveApproval||!validateSavedDigitalFranceLiveContractApproval(s.liveApproval)
      ||s.liveApproval.approval.version!==termsVersion||Date.parse(s.liveApproval.capturedAt)>Date.parse(s.acceptedAt)
      ||!Number.isFinite(Date.parse(s.acceptedAt))||new Date(s.acceptedAt).toISOString()!==s.acceptedAt
      ||s.customer?.type!=="INDIVIDUAL"||identity.name!==s.customer.name||identity.email!==s.customer.email||s.billingAddressSource!=="BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE"
      ||billingSnapshotHash(billingAddress)!==billingSnapshotHash(s.customer.billingAddress)
      ||s.licenseStatus!=="PERSONAL_PRIVATE_USE"||s.fiscalStatus!=="APPROVED_TERRITORY_SNAPSHOT")throw new DigitalError("CONTRACT_REQUIRES_REVIEW",409);
    return{snapshot:s,snapshotHash:billingSnapshotHash(s),termsHash};
  }
  if (s?.mode !== "TEST" || ![DIGITAL_CONTRACT_POLICY,"DCN-1.1-QA-EXPLICIT-RECEIPT",DIGITAL_FRANCE_CONTRACT_POLICY].includes(s.policy) || s.terms?.version !== termsVersion
    || typeof s.terms.text !== "string" || !s.terms.text || !s.earlyDelivery?.expresslyRequested || !s.withdrawal?.expresslyAcknowledged
    || !s.customer?.email || !s.acceptedAt || createHash("sha256").update(s.terms.text).digest("hex") !== termsHash) throw new DigitalError("CONTRACT_REQUIRES_REVIEW", 409);
  if (s.policy === DIGITAL_FRANCE_CONTRACT_POLICY || termsVersion === DIGITAL_FRANCE_TERMS_VERSION) {
    const exact = digitalContractTerms(termsVersion), at = typeof s.acceptedAt === "string" ? new Date(s.acceptedAt) : new Date(NaN);
    if (s.policy !== DIGITAL_FRANCE_CONTRACT_POLICY || termsVersion !== DIGITAL_FRANCE_TERMS_VERSION
      || Number.isNaN(at.getTime()) || at.toISOString() !== s.acceptedAt || s.customer.type !== "INDIVIDUAL"
      || typeof s.customer.name !== "string" || !s.customer.name.trim() || typeof s.customer.email !== "string" || !s.customer.email.trim()
      || s.terms.text !== exact.text || termsHash !== exact.hash || s.terms.hashSha256 !== exact.hash
      || s.terms.documentHashSha256 !== digitalFranceTermsDraft.hashSha256 || s.terms.status !== "DRAFT" || s.terms.expresslyAccepted !== true
      || !s.terms.sections || billingSnapshotHash(s.terms.sections) !== billingSnapshotHash(digitalFranceTermsDraft.sections)
      || s.earlyDelivery.expresslyRequested !== true || s.earlyDelivery.text !== exact.earlyDeliveryText
      || s.withdrawal.expresslyAcknowledged !== true || s.withdrawal.text !== exact.withdrawalText
      || s.approvedForLive !== false || s.licenseStatus !== "PROPOSED_NOT_LIVE_APPROVED" || s.fiscalStatus !== "LOCAL_REVIEW_ONLY") throw new DigitalError("CONTRACT_REQUIRES_REVIEW", 409);
  }
  // Terms use the existing text SHA, not a hash of the changing offer or template.
  return { snapshot: s, snapshotHash: billingSnapshotHash(s), termsHash };
}
export function digitalEmailTemplate(input: { kind: string; orderId: string; totalCents: number; titles: string[]; base: string; documentNumber?: string; mode?:DigitalMode }) {
  const base = new URL(input.base);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || input.mode==="LIVE"&&base.origin!=="https://www.lnxbeats.fr") throw new DigitalError("INVALID_BASE");
  const link = new URL(`/musique/confirmation/${input.orderId}`, base).href;
  let subject = input.kind === "REFUND_CONFIRMED" ? "TEST — Remboursement numérique confirmé"
    : input.kind === "FREE_COMPLETION_AVAILABLE" ? "TEST — Votre complément d’album sans paiement"
    : input.kind === "ACCESS_READY" ? "TEST — Vos acquisitions numériques sont disponibles"
      : input.kind === "INCIDENT" ? "TEST — Votre achat numérique nécessite une vérification" : "TEST — Confirmation de votre achat numérique";
  let message = input.kind === "ACCESS_READY" ? "Votre confirmation contractuelle a été reçue selon le parcours QA. Retrouvez vos fichiers et justificatifs dans votre compte."
    : input.kind === "FREE_COMPLETION_AVAILABLE" ? "Votre complément d’album est attribué sans nouveau paiement. Aucun prestataire de paiement n’a été appelé et aucune facture d’encaissement fictif n’est créée. Téléchargez la confirmation contractuelle puis accusez réception dans votre compte avant le commencement de la fourniture QA. Cet email d’information seul ne prouve pas la remise."
    : input.kind === "REFUND_CONFIRMED" ? "Le remboursement a été confirmé côté serveur. L’avoir correspondant est conservé sans modifier la facture initiale."
      : input.kind === "INCIDENT" ? "Une incohérence nécessite une revue. Ne recommencez pas le paiement. Vos autres acquisitions ne sont pas affectées."
        : "Votre paiement est confirmé. Téléchargez la confirmation contractuelle puis accusez réception dans votre compte avant le commencement de la fourniture QA. Cet email d’information seul ne prouve pas la remise.";
  const amount = `${Math.floor(input.totalCents / 100)},${String(input.totalCents % 100).padStart(2, "0")} EUR`;
  const live=input.mode==="LIVE";
  if(live){subject=subject.replace(/^TEST — /,"");
    message=input.kind==="ACCESS_READY"?"La réception de votre confirmation contractuelle a été reconnue. Retrouvez vos fichiers et justificatifs dans votre compte."
      :input.kind==="REFUND_CONFIRMED"?"Le remboursement confirmé et son avoir sont disponibles dans votre compte. Les droits conservés ou retirés sont indiqués pour cet achat."
      :input.kind==="INCIDENT"?"Votre achat nécessite une vérification. Son historique est conservé ; aucune nouvelle opération financière automatique n’est annoncée."
      :input.kind==="FREE_COMPLETION_AVAILABLE"?"Votre complément d’album est attribué sans nouveau paiement. Conservez sa confirmation depuis votre compte."
      :"Votre paiement est confirmé. Téléchargez et conservez votre confirmation contractuelle, puis reconnaissez sa réception avant de commencer la fourniture. Cet e-mail d’information ne prouve pas à lui seul sa remise.";}
  const lines = [live?"LNX Beats · Votre musique":"LNX Beats · DCN local TEST", message, input.titles.join(" / "), amount, input.documentNumber ?? "", link,
    live?"Usage privé uniquement. Aucun droit de publication, de distribution ou de monétisation accordé.":"Prix et conditions QA, sans valeur comptable. Aucun droit de publication, de distribution ou de monétisation accordé."].filter(Boolean);
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return { subject, text: lines.join("\n\n"), html: `<html lang="fr"><body style="background:#080b0d;color:#f5f4ed;font:16px Arial;padding:24px"><h1 style="color:#ffd264">LNX Beats</h1>${lines.slice(1, -2).map(l => `<p>${escape(l)}</p>`).join("")}<p><a style="color:#ffd264" href="${escape(link)}">Ouvrir mon compte authentifié</a></p><p>${escape(lines.at(-1)!)}</p></body></html>` };
}

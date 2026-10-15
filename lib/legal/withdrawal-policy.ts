import { createHash } from "node:crypto";
import { consumerRequestLabel } from "./withdrawal-copy";
import { billingSnapshotHash } from "@/lib/billing/domain";
export const CONSUMER_ACKNOWLEDGEMENT_POLICY = "LNX-CONSUMER-ACK-CANONICAL-1";

type EvidenceOrder = {
  userId: string; earlyDelivery: boolean; withdrawalAcknowledged: boolean; termsVersion: string; termsHash: string;
  contractSnapshot: unknown;
  fulfillment?: { confirmationStatus: string; confirmationAt: Date | null; confirmationEvidence: unknown; accessReadyAt: Date | null } | null;
  documents: Array<{ id: string; kind: string; status: string; snapshotHash: string; pdfHash?: string | null }>;
  events: Array<{ kind: string; actorId: string | null; createdAt: Date; details: unknown }>;
};

/** Evidence checklist for a HUMAN, never an eligibility/refund decision or a device-storage claim. */
export function assessDigitalWithdrawalEvidence(order: EvidenceOrder) {
  const s = order.contractSnapshot as { mode?: string; acceptedAt?: string; terms?: { version?: string; text?: string }; earlyDelivery?: { expresslyRequested?: boolean }; withdrawal?: { expresslyAcknowledged?: boolean } } | null;
  const acceptedAt = s?.acceptedAt && !Number.isNaN(Date.parse(s.acceptedAt)) ? new Date(s.acceptedAt) : null;
  const termsMatch = !!s?.terms?.text && s.terms.version === order.termsVersion
    && createHash("sha256").update(s.terms.text).digest("hex") === order.termsHash;
  const expressConsent = !!acceptedAt && termsMatch && order.earlyDelivery && s?.earlyDelivery?.expresslyRequested === true;
  const acknowledgementOfLoss = !!acceptedAt && termsMatch && order.withdrawalAcknowledged && s?.withdrawal?.expresslyAcknowledged === true;
  const f = order.fulfillment, evidence = f?.confirmationEvidence as { documentId?: string; policy?: string; type?: string } | null;
  const document = order.documents.find(d => d.id === evidence?.documentId && d.kind === "CONTRACT" && d.status === "READY" && /^[a-f0-9]{64}$/.test(d.snapshotHash) && /^[a-f0-9]{64}$/.test(d.pdfHash ?? ""));
  const documentTransmissionRecorded = !!document && order.events.some(e => e.kind === "DOCUMENT_TRANSFER_FINISHED" && e.actorId === order.userId
    && (e.details as { documentId?: string } | null)?.documentId === document.id);
  const explicitReceiptRecorded = !!f && f.confirmationStatus === "ACKNOWLEDGED" && !!f.confirmationAt && documentTransmissionRecorded;
  // The current TEST policy expressly does NOT claim legally effective receipt.
  const durableConfirmation = explicitReceiptRecorded && s?.mode === "LIVE" && evidence?.policy === "LEGAL_DURABLE_RECEIPT_VERIFIED";
  const executionStarted = !!f?.confirmationAt && order.events.some(e => e.kind === "DOWNLOAD_STARTED" && e.actorId === order.userId
    && e.createdAt >= f.confirmationAt! && typeof (e.details as { ticketId?: unknown } | null)?.ticketId === "string");
  return Object.freeze({ decision: "HUMAN_REVIEW_REQUIRED" as const, expressConsent, acknowledgementOfLoss, documentTransmissionRecorded,
    explicitReceiptRecorded, durableConfirmation, executionStarted,
    exceptionCandidate: expressConsent && acknowledgementOfLoss && durableConfirmation && executionStarted,
    limitations: ["Aucune décision automatique fondée sur deux cases ou sur le seul délai de quatorze jours.",
      "Une capture e-mail QA ou un flux serveur ne prouve ni remise juridique effective ni conservation sur l’appareil.",
      "La complétude de l’information et toute prolongation du délai restent à examiner humainement."] });
}

export function withdrawalReceiptText(snapshot: unknown, hash: string) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Invalid acknowledgement");
  const s = snapshot as Record<string, unknown>;
  let actual: string;
  if (s.policy === CONSUMER_ACKNOWLEDGEMENT_POLICY) actual = billingSnapshotHash(snapshot);
  else if (s.policy === undefined) {
    // Historical hashes used insertion order. Restore that exact known legacy
    // whitelist, never rewrite its hash and never trust arbitrary JSONB order.
    const keys = ["requestNumber", "receivedAt", "contractType", "claimedOrderReference", "claimantName", "claimantEmail", "productDescription", "quantity", "declaration", "status", "eligibility", "professional", "contact"];
    if (Object.keys(s).length !== keys.length || Object.keys(s).some(k => !keys.includes(k))) throw new Error("Unknown acknowledgement policy");
    actual = createHash("sha256").update(JSON.stringify(Object.fromEntries(keys.map(k => [k, s[k]])))).digest("hex");
  } else throw new Error("Unknown acknowledgement policy");
  if (actual !== hash) throw new Error("Acknowledgement integrity mismatch");
  const kind = typeof s.requestKind === "string" ? s.requestKind : "WITHDRAWAL";
  const text = ["LNX Beats — Accusé de réception de déclaration", `Nature : ${consumerRequestLabel(kind)}`,
    `Référence : ${s.requestNumber}`, `Réception (date et heure UTC) : ${s.receivedAt}`, `Contrat déclaré : ${s.claimedOrderReference}`,
    `Demandeur : ${s.claimantName}`, `Adresse électronique pour l’accusé : ${s.claimantEmail}`, `Produit ou contenu : ${s.productDescription}`,
    ...(s.quantity ? [`Quantité : ${s.quantity}`] : []), ...(s.reason ? [`Précision facultative : ${s.reason}`] : []),
    `Déclaration : ${s.declaration}`, `Professionnel : ${s.professional}`, `Contact : ${s.contact}`,
    "La déclaration a été reçue. L’éligibilité et les suites éventuelles font l’objet d’une revue humaine. Aucun remboursement n’est déclenché par cet accusé.",
    `Empreinte SHA-256 du contenu archivé : ${hash}`];
  return `${text.join("\n\n")}\n`;
}

export function withdrawalAcknowledgementTemplate(snapshot: unknown, hash: string) {
  const text = withdrawalReceiptText(snapshot, hash);
  const escaped = text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return { subject: "LNX Beats — Accusé de réception de votre déclaration", text, html: `<html lang="fr"><body><pre style="white-space:pre-wrap;font:16px sans-serif">${escaped}</pre></body></html>` };
}

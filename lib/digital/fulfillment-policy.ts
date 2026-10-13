import { billingSnapshotHash } from "@/lib/billing/domain";
import { createHash } from "node:crypto";
import { DIGITAL_EARLY_DELIVERY_TEXT, DIGITAL_WITHDRAWAL_TEXT, DIGITAL_TERMS_TEXT, DIGITAL_TERMS_VERSION, DigitalError } from "./domain";

export const DIGITAL_FISCAL_REVIEW_NOTICE = "TEST : fiscalité des contenus numériques à valider. Aucun régime ni taux réel présumé.";
export const DIGITAL_CONTRACT_POLICY = "DCN-1.1-QA-EXPLICIT-RECEIPT";
export function digitalContractSnapshot(customer: { email: string; name: string }, acceptedAt: Date) {
  return { mode: "TEST", policy: DIGITAL_CONTRACT_POLICY, customer: { type: "INDIVIDUAL", name: customer.name, email: customer.email },
    acceptedAt: acceptedAt.toISOString(), terms: { version: DIGITAL_TERMS_VERSION, text: DIGITAL_TERMS_TEXT },
    earlyDelivery: { expresslyRequested: true, text: DIGITAL_EARLY_DELIVERY_TEXT },
    withdrawal: { expresslyAcknowledged: true, text: DIGITAL_WITHDRAWAL_TEXT },
    licenseStatus: "PROPOSED_NOT_LIVE_APPROVED", fiscalStatus: "LOCAL_REVIEW_ONLY" };
}
export function verifyContractSnapshot(snapshot: unknown, termsVersion: string, termsHash: string) {
  const s = snapshot as ReturnType<typeof digitalContractSnapshot>;
  if (s?.mode !== "TEST" || s.policy !== DIGITAL_CONTRACT_POLICY || s.terms?.version !== termsVersion
    || !s.terms.text || !s.earlyDelivery?.expresslyRequested || !s.withdrawal?.expresslyAcknowledged
    || !s.customer?.email || !s.acceptedAt || createHash("sha256").update(s.terms.text).digest("hex") !== termsHash) throw new DigitalError("CONTRACT_REQUIRES_REVIEW", 409);
  // Terms use the existing text SHA, not a hash of the changing offer or template.
  return { snapshot: s, snapshotHash: billingSnapshotHash(s), termsHash };
}
export function digitalEmailTemplate(input: { kind: string; orderId: string; totalCents: number; titles: string[]; base: string; documentNumber?: string }) {
  const base = new URL(input.base);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new DigitalError("INVALID_BASE");
  const link = new URL(`/musique/confirmation/${input.orderId}`, base).href;
  const subject = input.kind === "REFUND_CONFIRMED" ? "TEST — Remboursement numérique confirmé"
    : input.kind === "ACCESS_READY" ? "TEST — Vos acquisitions numériques sont disponibles"
      : input.kind === "INCIDENT" ? "TEST — Votre achat numérique nécessite une vérification" : "TEST — Confirmation de votre achat numérique";
  const message = input.kind === "ACCESS_READY" ? "Votre confirmation contractuelle a été reçue selon le parcours QA. Retrouvez vos fichiers et justificatifs dans votre compte."
    : input.kind === "REFUND_CONFIRMED" ? "Le remboursement a été confirmé côté serveur. L’avoir correspondant est conservé sans modifier la facture initiale."
      : input.kind === "INCIDENT" ? "Une incohérence nécessite une revue. Ne recommencez pas le paiement. Vos autres acquisitions ne sont pas affectées."
        : "Votre paiement est confirmé. Téléchargez la confirmation contractuelle puis accusez réception dans votre compte avant le commencement de la fourniture QA. Cet email d’information seul ne prouve pas la remise.";
  const amount = `${Math.floor(input.totalCents / 100)},${String(input.totalCents % 100).padStart(2, "0")} EUR`;
  const lines = ["LNX Beats · DCN local TEST", message, input.titles.join(" / "), amount, input.documentNumber ?? "", link,
    "Prix et conditions QA, sans valeur comptable. Aucun droit de publication, de distribution ou de monétisation accordé."].filter(Boolean);
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return { subject, text: lines.join("\n\n"), html: `<html lang="fr"><body style="background:#080b0d;color:#f5f4ed;font:16px Arial;padding:24px"><h1 style="color:#ffd264">LNX Beats</h1>${lines.slice(1, -2).map(l => `<p>${escape(l)}</p>`).join("")}<p><a style="color:#ffd264" href="${escape(link)}">Ouvrir mon compte authentifié</a></p><p>${escape(lines.at(-1)!)}</p></body></html>` };
}

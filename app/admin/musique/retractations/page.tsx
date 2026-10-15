import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { listDigitalConsumerRequests } from "@/lib/legal/withdrawal-admin";
import { consumerRequestLabel } from "@/lib/legal/withdrawal-copy";
import { DigitalConsumerReview } from "@/components/digital-consumer-review";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demandes numériques — rétractation et garanties", robots: { index: false, follow: false } };
export default async function Page() {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  const { user } = await requireAdmin(), rows = await listDigitalConsumerRequests(user);
  return <div className="admin-main"><header className="admin-page-heading"><h1>Rétractation, conformité et gestes commerciaux.</h1><Link href="/admin/musique">Registre numérique</Link></header>
    <p>DCN local TEST. 50 demandes les plus récentes ; historique complet conservé. Aucune décision ni restitution automatique.</p>
    {!rows.length ? <p>Aucune demande numérique.</p> : rows.map(r => <section className="admin-panel" key={r.id}><h2>{r.requestNumber} — {consumerRequestLabel(r.requestKind)}</h2>
      <p>{r.receivedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · {r.status} · {r.eligibilityReview}</p><p>{r.claimantFirstName} {r.claimantLastName} · {r.claimantEmail}</p>
      <p>Référence déclarée : {r.claimedOrderReference} · {r.identityMatch === "MATCHED" ? "Correspondance avec le compte de l’achat" : "Identité/contrat non rapprochés — vérification humaine nécessaire"}</p><p>{r.productDescription}</p>{r.reason ? <p>Précision facultative : {r.reason}</p> : null}
      <h3>Accusé et preuve</h3><p>Accusé archivé : {r.acknowledgementHashSha256}. File e-mail : {r.digitalAcknowledgements.map(n => `${n.status} (${n.attempts} tentative(s))`).join(" · ") || "non créée"}. CAPTURED_QA ne vaut pas envoi réel.</p>
      {r.evidence ? <><h3>Exception numérique — revue cumulative obligatoire</h3><ul><li>Consentement exprès enregistré : {r.evidence.expressConsent ? "oui" : "non démontré"}</li><li>Reconnaissance expresse de la perte : {r.evidence.acknowledgementOfLoss ? "oui" : "non démontrée"}</li><li>Confirmation durable juridiquement démontrée : {r.evidence.durableConfirmation ? "oui" : "non — les preuves locales QA ne suffisent pas"}</li><li>Commencement de fourniture par le serveur enregistré : {r.evidence.executionStarted ? "oui (aucune preuve de stockage sur appareil)" : "non démontré"}</li></ul>{r.evidence.limitations.map(l => <p key={l}>{l}</p>)}</> : null}
      {r.reviewReason ? <p>Dernière revue : {r.reviewReason} · {r.reviewedByUserId} · {r.reviewedAt?.toLocaleString("fr-FR") ?? "en cours"}</p> : null}
      <h3>Historique des revues</h3><p>Au plus 100 dernières revues des demandes affichées ; journal complet append-only conservé.</p><ul>{r.history.map(e => <li key={e.id}>{e.createdAt.toLocaleString("fr-FR")} · {e.decision} · opérateur {e.actorId} · audit {e.id}</li>)}</ul>
      {["RECEIVED", "UNDER_REVIEW"].includes(r.status) ? <DigitalConsumerReview requestId={r.id} updatedAt={r.updatedAt.toISOString()} matched={r.identityMatch === "MATCHED"} /> : <p>Décision historique conservée ; aucun nouvel effet financier automatique.</p>}
      {r.digitalOrderId ? <Link href={`/admin/musique/achats/${r.digitalOrderId}`}>Consulter l’achat et le remboursement séparément contrôlé</Link> : null}</section>)}</div>;
}

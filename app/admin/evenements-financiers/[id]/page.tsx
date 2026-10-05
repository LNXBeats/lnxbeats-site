import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getFinancialEventReview } from "@/lib/admin/financial-event-review";
import { resolveExpiredCheckoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revue de l’événement financier", robots: { index: false, follow: false } };

export default async function FinancialEventPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getFinancialEventReview(id);
  if (!detail) notFound();
  const { row, proof, classification } = detail;
  const date = (value: Date) => value.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const order = row.payment?.order?.orderNumber ?? row.payment?.shopOrder?.orderNumber;
  const state = (await searchParams).etat;
  return <div className="admin-main">
    <Link href="/admin/evenements-financiers">Historique des événements financiers</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">Revue technique — aucun mouvement financier</p><h1>{row.provider} · {row.type}</h1></div></header>
    {state === "revue-requise" ? <p role="alert">Le classement est refusé. L’alerte reste à examiner.</p> : null}
    <section className="admin-list-window"><h2>État et preuve</h2><dl>
      <dt>Événement</dt><dd style={{ overflowWrap: "anywhere" }}>{row.providerEventId}</dd>
      <dt>Date (Europe/Paris)</dt><dd>{date(row.processedAt)}</dd>
      <dt>Environnement</dt><dd>{row.livemode ? "LIVE" : "TEST"}</dd>
      <dt>Session checkout</dt><dd style={{ overflowWrap: "anywhere" }}>{row.objectId ?? "Non disponible"}</dd>
      <dt>Reçu signé</dt><dd>{row.outcome} (conservé)</dd>
      <dt>État prestataire actuel</dt><dd>{proof ? `${proof.status ?? "inconnu"} · ${proof.paymentStatus}` : "Non vérifiable — revue maintenue"}</dd>
      <dt>Montant du checkout (pas une recette)</dt><dd>{proof?.amountCents != null && proof.currency ? `${(proof.amountCents / 100).toFixed(2)} ${proof.currency.toUpperCase()}` : "Inconnu"}</dd>
      <dt>Paiement capturé</dt><dd>{({ YES: "Oui", NO: "Non", UNKNOWN: "Inconnu" })[classification.captured]}</dd>
      <dt>PaymentIntent</dt><dd>{proof ? proof.paymentIntentId ?? "Aucun" : "Inconnu"}</dd>
      <dt>Commande corrélée</dt><dd>{order ?? "Non"}</dd>
      <dt>Domaine identifié</dt><dd>{classification.noOrderExpected ? "Soutien — aucune commande à créer" : "À vérifier"}</dd>
      {row.support ? <><dt>Référence soutien / état local</dt><dd>{row.support.id} · {row.support.status}</dd><dt>Référence paiement / remboursement locale</dt><dd>{row.support.paymentReference ?? "Aucune"} / {row.support.refundReference ?? "Aucune"}</dd></> : null}
      <dt>Raison / risque</dt><dd>{classification.reason} {classification.risk}</dd>
    </dl></section>
    {row.technicalReview ? <section className="admin-list-window"><h2>Audit du classement</h2><p>{date(row.technicalReview.createdAt)} · {row.technicalReview.reason}</p><p>Administrateur : {row.technicalReview.actorId}</p><p>Preuve conservée à la date du classement. Aucun paiement, commande ou contribution modifié.</p></section>
      : classification.eligible ? <form action={resolveExpiredCheckoutAction}><input type="hidden" name="eventId" value={row.id} /><label><input type="checkbox" name="confirmation" value="expired-unpaid" required /> Je confirme le classement technique seul, sans paiement ni commande attendue.</label><button className="admin-button" type="submit">Classer comme checkout expiré sans paiement</button><p>La preuve prestataire et les états internes seront revérifiés avant toute écriture d’audit.</p></form>
        : <p>Action recommandée : conserver REQUIRES_REVIEW et examiner les workflows financiers existants. Aucun rapprochement arbitraire ni remboursement automatique. {row.support ? <Link href="/admin/soutiens">Registre des soutiens</Link> : <Link href="/admin/commandes">Commandes</Link>}</p>}
  </div>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addInternalNoteAction } from "@/app/admin/actions";
import { AdminOrderActions } from "@/components/admin-order-actions";
import { getAllowedOrderTransitions, getOrderDeletionEligibility } from "@/lib/admin/order-machine";
import { getAdminOrder } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { formatEuro } from "@/lib/orders/domain";
import { orderStatusPresentation } from "@/lib/orders/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Détail commande" };

type AdminOrderPageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
};

const stateMessages: Record<string, string> = {
  "statut-mis-a-jour": "Le statut et son événement ont été enregistrés atomiquement.",
  "transition-refusee": "Cette transition n’est pas autorisée depuis le statut actuel.",
  "note-ajoutee": "La note interne a été ajoutée. Elle reste invisible dans l’espace client.",
  "note-invalide": "La note n’a pas été ajoutée. Vérifiez sa longueur.",
  "suppression-refusee": "Cette commande doit être conservée : la règle de suppression serveur a refusé l’action.",
};

const licenseStatusLabels = {
  REQUESTED: "Demandée",
  CONTRACT_PENDING: "Contrat à préparer",
  PAYMENT_PENDING: "Paiement en attente",
  ACTIVE: "Active",
  REJECTED: "Refusée",
  CANCELLED: "Annulée",
} as const;

const licensePaymentLabels = {
  NOT_STARTED: "Non commencé",
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  REFUND_PENDING: "Remboursement en attente",
  REFUNDED: "Remboursé",
} as const;

export default async function AdminOrderPage({ params, searchParams }: AdminOrderPageProps) {
  await requireAdmin();
  const { orderNumber } = await params;
  const order = await getAdminOrder(orderNumber);
  if (!order) notFound();
  const transitions = getAllowedOrderTransitions(order.status);
  const deletion = getOrderDeletionEligibility(order);
  const message = stateMessages[(await searchParams).etat ?? ""];
  const currentStatus = orderStatusPresentation[order.status];

  return (
    <div className="admin-main admin-order-detail">
      <Link className="admin-back-link" href="/admin/commandes"><span aria-hidden="true">←</span> Toutes les commandes</Link>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      <header className="admin-order-hero">
        <div><p className="admin-kicker">{order.orderNumber}</p><h1>{order.title || order.recipient || "Histoire sans titre"}</h1><p>{order.customerName || "Client"} · {order.customerEmail}</p></div>
        <div><span>Statut actuel</span><strong>{currentStatus.label}</strong><small>Créée le {new Date(order.createdAt).toLocaleDateString("fr-FR")}</small></div>
      </header>

      <div className="admin-order-detail__grid">
        <div className="admin-order-detail__main">
          <section className="admin-detail-window" aria-labelledby="admin-brief-title">
            <p className="admin-section-label">Brief complet</p><h2 id="admin-brief-title">Ce qui a été confié.</h2>
            <dl className="admin-detail-facts">
              <div><dt>Destinataire</dt><dd>{order.recipient || "Non renseigné"}</dd></div>
              <div><dt>Contexte</dt><dd>{order.occasion || "Non renseigné"}</dd></div>
              <div><dt>Direction musicale</dt><dd>{order.musicalDirection || "Non renseignée"}</dd></div>
              <div><dt>Émotion</dt><dd>{order.emotion || "Non renseignée"}</dd></div>
              <div className="admin-detail-facts__wide"><dt>Histoire</dt><dd>{order.brief || "Non renseignée"}</dd></div>
              {order.importantDetails ? <div className="admin-detail-facts__wide"><dt>Détails importants</dt><dd>{order.importantDetails}</dd></div> : null}
              {order.wordsToInclude ? <div><dt>Mots à inclure</dt><dd>{order.wordsToInclude}</dd></div> : null}
              {order.avoid ? <div><dt>À éviter</dt><dd>{order.avoid}</dd></div> : null}
              {order.pronunciationNotes ? <div><dt>Prononciations</dt><dd>{order.pronunciationNotes}</dd></div> : null}
            </dl>
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-photos-title">
            <p className="admin-section-label">Références privées</p><h2 id="admin-photos-title">Photos client.</h2>
            {order.assets.length ? (
              <ul className="admin-private-photos">
                {order.assets.map(({ asset, position }) => (
                  <li key={asset.id}>
                    {/* Private authenticated response: bypassing the public image optimizer is intentional. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/orders/${encodeURIComponent(order.orderNumber)}/photos/${asset.id}`} alt={`Référence privée ${position + 1}`} />
                    <span>{asset.width && asset.height ? `${asset.width} × ${asset.height} px` : "Dimensions non documentées"}</span>
                  </li>
                ))}
              </ul>
            ) : <p>Aucune photo jointe à cette commande.</p>}
          </section>

          <section className="admin-detail-window" aria-labelledby="admin-timeline-title">
            <p className="admin-section-label">Historique réel</p><h2 id="admin-timeline-title">Timeline.</h2>
            <ol className="admin-timeline">
              {order.events.map((event) => <li key={event.id}><span aria-hidden="true" /><div><time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString("fr-FR")}</time><p><strong>{orderStatusPresentation[event.toStatus].label}</strong>{event.visibility === "INTERNAL" ? <em>Interne</em> : <em>Client</em>}</p>{event.note ? <blockquote>{event.note}</blockquote> : null}{event.actor?.displayName ? <small>Par {event.actor.displayName}</small> : null}</div></li>)}
            </ol>
          </section>
        </div>

        <aside className="admin-order-detail__aside">
          <section className="admin-side-window">
            <p className="admin-section-label">Prix snapshot</p><strong className="admin-price">{formatEuro(order.totalCents)}</strong>
            <dl><div><dt>Création</dt><dd>{formatEuro(order.basePriceCents)}</dd></div><div><dt>Cover</dt><dd>{order.coverIncluded ? formatEuro(order.coverPriceCents) : "Non"}</dd></div><div><dt>Priorité</dt><dd>{order.priorityProcessing ? formatEuro(order.priorityPriceCents) : "Non"}</dd></div><div><dt>Révisions</dt><dd>{order.revisionUsed} / {order.revisionAllowance}</dd></div></dl>
            <small>Tarif {order.pricingVersion}. Aucun paiement actif.</small>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-actions-title">
            <p className="admin-section-label">Prochaine étape</p><h2 id="admin-actions-title">Actions autorisées.</h2>
            <AdminOrderActions orderNumber={order.orderNumber} transitions={transitions} deletionEligible={deletion.eligible} deletionReason={deletion.reason} />
          </section>

          <details className="admin-side-window admin-note-panel">
            <summary>Ajouter une note interne</summary><p>Cette note ne sera jamais affichée dans l’espace client.</p>
            <form action={addInternalNoteAction}><input type="hidden" name="orderNumber" value={order.orderNumber} /><label htmlFor="internal-note">Note</label><textarea id="internal-note" name="note" rows={5} maxLength={1000} required /><button type="submit">Enregistrer la note</button></form>
          </details>

          <section className="admin-side-window">
            <p className="admin-section-label">Livraison</p><h2>{order.deliveredAt ? "Marquée comme livrée" : "Non encore activée"}</h2><p>Aucun fichier WAV n’est simulé. Le stockage de livraison fera l’objet d’un sprint dédié.</p>
          </section>

          <section className="admin-side-window" aria-labelledby="admin-rights-title">
            <p className="admin-section-label">Droits commerciaux</p><h2 id="admin-rights-title">{order.commercialLicenses.length ? "Demande enregistrée" : "Aucune demande"}</h2>
            {order.commercialLicenses.map((license) => <dl key={license.id}><div><dt>Prix</dt><dd>{formatEuro(license.priceCents)}</dd></div><div><dt>Statut</dt><dd>{licenseStatusLabels[license.status]}</dd></div><div><dt>Contrat</dt><dd>{license.contractRequired ? "Requis" : "Non"}</dd></div><div><dt>Paiement</dt><dd>{licensePaymentLabels[license.paymentStatus]}</dd></div></dl>)}
            {order.commercialLicenses.length ? <p>Contrat spécifique requis avant activation. Le traitement reste en lecture seule tant qu’un historique contractuel dédié n’existe pas.</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

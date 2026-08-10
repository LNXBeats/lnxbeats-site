import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { formatEuro, type OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";
import { orderStatusPresentation } from "@/lib/orders/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Suivi de commande",
  description: "Suivi privé d’une demande LNX Beats.",
  robots: { index: false, follow: false },
};

type OrderDetailPageProps = { params: Promise<{ orderNumber: string }> };

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { orderNumber } = await params;
  const session = await requireVerifiedUser(`/compte/commandes/${orderNumber}`);
  const actor: OrderActor = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
  const order = await getOrderForActor(actor, orderNumber);
  if (!order) notFound();
  const status = orderStatusPresentation[order.status];

  return (
    <section className="auth-shell order-detail-shell">
      <Container className="order-detail">
        <Link className="back-link" href="/compte"><span aria-hidden="true">←</span> Retour à mon espace</Link>
        <header className="order-detail__header">
          <div>
            <p className="eyebrow">{order.orderNumber}</p>
            <h1>{order.title || order.recipient || "Votre histoire"}</h1>
            <p>{status.next}</p>
          </div>
          <div className="order-detail__status"><span>Statut actuel</span><strong>{status.label}</strong></div>
        </header>

        <div className="order-detail__grid">
          <section className="order-detail__main" aria-labelledby="order-timeline-title">
            <p className="auth-panel__label">Progression</p>
            <h2 id="order-timeline-title">Le chemin de votre demande.</h2>
            <ol className="order-timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("fr-FR")}</time><strong>{orderStatusPresentation[event.toStatus].label}</strong>{event.note ? <p>{event.note}</p> : null}</div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="order-detail__price" aria-label="Prix de la demande">
            <span>Montant calculé</span><strong>{formatEuro(order.totalCents)}</strong>
            <p>{order.usage === "PERSONAL" ? "Usage personnel" : "Exploitation commerciale étendue"}</p>
            <small>Version tarifaire {order.pricingVersion} · paiement non encore disponible</small>
          </aside>
        </div>

        <section className="order-detail__section" aria-labelledby="order-brief-title">
          <p className="auth-panel__label">Récapitulatif</p>
          <h2 id="order-brief-title">L’histoire confiée.</h2>
          <dl className="order-detail__facts">
            <div><dt>Personne ou situation</dt><dd>{order.recipient}</dd></div>
            {order.occasion ? <div><dt>Contexte</dt><dd>{order.occasion}</dd></div> : null}
            <div><dt>Direction</dt><dd>{order.musicalDirection}</dd></div>
            {order.emotion ? <div><dt>Émotion</dt><dd>{order.emotion}</dd></div> : null}
            <div className="order-detail__fact--wide"><dt>Histoire</dt><dd>{order.brief}</dd></div>
            {order.importantDetails ? <div className="order-detail__fact--wide"><dt>Détails</dt><dd>{order.importantDetails}</dd></div> : null}
            {order.wordsToInclude ? <div><dt>Mots à préserver</dt><dd>{order.wordsToInclude}</dd></div> : null}
            {order.avoid ? <div><dt>À éviter</dt><dd>{order.avoid}</dd></div> : null}
            {order.pronunciationNotes ? <div><dt>Prononciations</dt><dd>{order.pronunciationNotes}</dd></div> : null}
            <div><dt>Cover</dt><dd>{order.coverIncluded ? "Incluse (+10 €)" : "Non"}</dd></div>
            <div><dt>Priorité</dt><dd>{order.priorityProcessing ? "Demandée (+30 €), délai à confirmer" : "Non"}</dd></div>
            <div><dt>Retour inclus</dt><dd>{order.revisionAllowance - order.revisionUsed} sur {order.revisionAllowance} restant</dd></div>
          </dl>
        </section>

        <section className="order-detail__section" aria-labelledby="order-photos-title">
          <p className="auth-panel__label">Références privées</p>
          <h2 id="order-photos-title">Photos jointes.</h2>
          {order.photos.length ? (
            <ul className="order-detail__photos">
              {order.photos.map((photo) => (
                <li key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/orders/${encodeURIComponent(order.orderNumber)}/photos/${photo.id}`} alt={`Photo de référence ${photo.position + 1}`} />
                </li>
              ))}
            </ul>
          ) : <p>Aucune photo jointe à cette demande.</p>}
        </section>

        <section className="order-detail__section order-delivery-future" aria-labelledby="order-delivery-title">
          <p className="auth-panel__label">Livraison future</p>
          <h2 id="order-delivery-title">Un WAV privé, jamais un lien public permanent.</h2>
          <p>La livraison sera accessible uniquement au propriétaire et à l’administration, pendant six mois à compter de sa mise à disposition.</p>
          {order.downloadExpiresAt ? <p>Date d’expiration : <time dateTime={order.downloadExpiresAt}>{new Date(order.downloadExpiresAt).toLocaleDateString("fr-FR")}</time>.</p> : <p>Aucun fichier n’est encore disponible.</p>}
        </section>
      </Container>
    </section>
  );
}

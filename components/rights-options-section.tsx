import Link from "next/link";

import { formatEuro } from "@/lib/orders/domain";
import { rightsStatusPresentation } from "@/lib/rights/domain";
import type { SerializedRightsRequest } from "@/lib/rights/types";

export function RightsOptionsSection({
  orderNumber,
  requests,
}: {
  orderNumber: string;
  requests: readonly SerializedRightsRequest[];
}) {
  const publication = requests.find(({ type, status }) => type === "PUBLICATION_LICENSE" && !["REJECTED", "CANCELLED"].includes(status));
  const partnership = requests.find(({ type, status }) => type === "EXPLOITATION_PARTNERSHIP" && !["REJECTED", "CANCELLED"].includes(status));
  return (
    <section className="order-detail__section rights-options" aria-labelledby="rights-options-title">
      <p className="auth-panel__label">Droits et autorisations</p>
      <h2 id="rights-options-title">Publier ou exploiter votre création.</h2>
      <p className="rights-options__intro">La commande livrée couvre un usage personnel. Ces démarches préparent une étude et un document contractuel ; elles n’activent aucun droit et ne déclenchent aucun paiement.</p>
      <div className="rights-options__grid">
        <article className="rights-option-card">
          <p className="eyebrow">Licence de publication</p>
          <h3>Publier votre création</h3>
          <strong className="rights-option-card__price">{formatEuro(15_000)}</strong>
          <p>Demandez une autorisation contractuelle pour publier ou monétiser le morceau sur les plateformes sélectionnées, dans les limites prévues aux Conditions particulières.</p>
          {publication ? (
            <Link className="form-button form-button--primary" href={`/compte/droits/${encodeURIComponent(publication.requestNumber)}`}>SUIVRE MA DEMANDE</Link>
          ) : (
            <Link className="form-button form-button--primary" href={`/compte/commandes/${encodeURIComponent(orderNumber)}/droits/licence`}>PRÉPARER MA DEMANDE</Link>
          )}
          <small>{publication ? `${rightsStatusPresentation[publication.status].label}.` : "Aucun paiement n’est effectué à cette étape."}</small>
        </article>
        <article className="rights-option-card rights-option-card--partnership">
          <p className="eyebrow">Partenariat d’exploitation</p>
          <h3>Construire un projet de droits partagé</h3>
          <strong className="rights-option-card__price">{formatEuro(150_000)}</strong>
          <p>Pour les projets nécessitant une étude des contributions, une proposition contractuelle spécifique et, le cas échéant, une préparation de répartition des droits.</p>
          {partnership ? (
            <Link className="form-button" href={`/compte/droits/${encodeURIComponent(partnership.requestNumber)}`}>SUIVRE MON ÉTUDE</Link>
          ) : (
            <Link className="form-button" href={`/compte/commandes/${encodeURIComponent(orderNumber)}/droits/partenariat`}>DEMANDER L’ÉTUDE DU PROJET</Link>
          )}
          <small>{partnership ? `${rightsStatusPresentation[partnership.status].label}.` : "Validation manuelle de LNX Beats obligatoire avant tout contrat ou paiement."}</small>
        </article>
      </div>
      <p className="rights-options__legal">Aucune qualité d’auteur, quote-part SACEM, propriété de l’œuvre ou répartition 70/30 n’est attribuée automatiquement.</p>
    </section>
  );
}

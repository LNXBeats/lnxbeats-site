import Link from "next/link";

import { formatEuro } from "@/lib/orders/domain";
import { rightsOffers } from "@/data/rights-offer";
import { rightsStatusPresentation } from "@/lib/rights/domain";
import type { SerializedRightsRequest } from "@/lib/rights/types";

export function RightsOptionsSection({
  requests,
  eligible,
  commerceOpen,
  orderNumber,
  workTitle,
}: {
  requests: readonly SerializedRightsRequest[];
  eligible: boolean;
  commerceOpen: boolean;
  orderNumber: string;
  workTitle: string;
}) {
  const publication = requests.find(({ type, status }) => type === "PUBLICATION_LICENSE" && !["REJECTED", "CANCELLED"].includes(status));
  if (!publication && !(eligible && commerceOpen)) return null;
  return (
    <section className="order-detail__section rights-options" aria-labelledby="rights-options-title">
      <p className="auth-panel__label">Droits et autorisations</p>
      <h2 id="rights-options-title">Publier votre titre sur les plateformes.</h2>
      <p className="rights-options__intro">Votre morceau est livré. Une licence distincte peut autoriser sa publication via votre distributeur numérique, dans les limites du contrat applicable.</p>
      <div className="rights-options__grid">
        <article className="rights-option-card rights-option-card--publication" aria-labelledby="rights-publication-title">
          <header className="rights-option-card__header">
            <p className="eyebrow">Une œuvre · une licence</p>
            <h3 id="rights-publication-title">Licence de publication via distributeur</h3>
            <strong className="rights-option-card__price">{formatEuro(publication?.requestedPriceCents ?? rightsOffers.PUBLICATION_LICENSE.priceCents)}</strong>
          </header>
          <p className="rights-option-card__work"><span>Œuvre concernée</span><strong>{workTitle}</strong></p>
          <p className="rights-option-card__description">Licence non exclusive de cinq ans, valable dans le monde entier, pour publier cette œuvre via un distributeur numérique sur les plateformes compatibles.</p>
          <ul className="rights-option-card__benefits"><li>Liée uniquement à cette œuvre</li><li>Streaming et téléchargement</li><li>Contrat final et prise d’effet encadrée</li></ul>
          <div className="rights-option-card__cta">
            <Link className="form-button form-button--primary rights-option-card__action" href={publication ? `/compte/droits/${encodeURIComponent(publication.requestNumber)}` : `/compte/commandes/${encodeURIComponent(orderNumber)}/droits/licence`}>{publication ? "SUIVRE MA DEMANDE" : "DÉCOUVRIR LA LICENCE"}</Link>
          </div>
          <div className="rights-option-card__notice">
            <strong>{publication ? rightsStatusPresentation[publication.status].label : "Offre post-livraison"}.</strong>
            <small>Cette licence ne transfère pas la propriété intellectuelle de LNX Beats et ne garantit ni acceptation par un distributeur, ni revenus, ni Content ID.</small>
          </div>
        </article>
      </div>
      <aside className="rights-options__legal" role="note" aria-label="Information importante sur les droits">
        <span aria-hidden="true">i</span>
        <p>Aucune qualité d’auteur, propriété de l’œuvre ou validation par un tiers n’est attribuée automatiquement.</p>
      </aside>
    </section>
  );
}

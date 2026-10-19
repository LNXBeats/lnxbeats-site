import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import { getSiteLocale, serverMoney, serverT } from "@/lib/i18n/server";
import Link from "next/link";

import { rightsOffers } from "@/data/rights-offer";
import { rightsStatusPresentation } from "@/lib/rights/domain";
import type { SerializedRightsRequest } from "@/lib/rights/types";

export async function RightsOptionsSection({
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
  const locale = await getSiteLocale();
  const t = (source: string) => serverT(locale, source);
  const money = (cents: number) => serverMoney(locale, cents);
  const publication = requests.find(({ type, status }) => type === "PUBLICATION_LICENSE" && !["REJECTED", "CANCELLED"].includes(status));
  if (!publication && !(eligible && commerceOpen)) return null;
  return (
    <section className="order-detail__section rights-options" aria-labelledby="rights-options-title">
      <p className="auth-panel__label"><T text="Droits et autorisations" /></p>
      <h2 id="rights-options-title"><T text="Publier votre titre sur les plateformes." /></h2>
      <p className="rights-options__intro"><T text="Votre morceau est livré. Une licence distincte peut autoriser sa publication via votre distributeur numérique, dans les limites du contrat applicable." /></p>
      <div className="rights-options__grid">
        <article className="rights-option-card rights-option-card--publication" aria-labelledby="rights-publication-title">
          <header className="rights-option-card__header">
            <p className="eyebrow"><T text="Une œuvre · une licence" /></p>
            <h3 id="rights-publication-title"><T text="Licence de publication via distributeur" /></h3>
            <strong className="rights-option-card__price">{money(publication?.requestedPriceCents ?? rightsOffers.PUBLICATION_LICENSE.priceCents)}</strong>
          </header>
          <p className="rights-option-card__work"><span><T text="Œuvre concernée" /></span><strong>{<OriginalName>{workTitle}</OriginalName>}</strong></p>
          <p className="rights-option-card__description"><T text="Licence non exclusive de cinq ans, valable dans le monde entier, pour publier cette œuvre via un distributeur numérique sur les plateformes compatibles." /></p>
          <ul className="rights-option-card__benefits"><li><T text="Liée uniquement à cette œuvre" /></li><li><T text="Streaming et téléchargement" /></li><li><T text="Contrat final et prise d’effet encadrée" /></li></ul>
          <div className="rights-option-card__cta">
            <Link className="form-button form-button--primary rights-option-card__action" href={publication ? `/compte/droits/${encodeURIComponent(publication.requestNumber)}` : `/compte/commandes/${encodeURIComponent(orderNumber)}/droits/licence`}>{publication ? <T text="SUIVRE MA DEMANDE" /> : <T text="DÉCOUVRIR LA LICENCE" />}</Link>
          </div>
          <div className="rights-option-card__notice">
            <strong>{publication ? <T text={rightsStatusPresentation[publication.status].label}/> : <T text="Offre post-livraison" />}.</strong>
            <small><T text="Cette licence ne transfère pas la propriété intellectuelle de LNX Beats et ne garantit ni acceptation par un distributeur, ni revenus, ni Content ID." /></small>
          </div>
        </article>
      </div>
      <aside className="rights-options__legal" role="note" aria-label={t("Information importante sur les droits")}>
        <span aria-hidden="true">i</span>
        <p><T text="Aucune qualité d’auteur, propriété de l’œuvre ou validation par un tiers n’est attribuée automatiquement." /></p>
      </aside>
    </section>
  );
}

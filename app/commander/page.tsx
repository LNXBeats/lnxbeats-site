import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";
import { orderOffer } from "@/data/order-offer";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { getCommanderOrderForActor } from "@/lib/orders/service";
import { paymentQaAvailable } from "@/lib/payments/availability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confier une histoire",
  description: "Préparez, sauvegardez et suivez une demande de création musicale personnalisée avec LNX Beats.",
  alternates: { canonical: "/commander" },
};

type OrderPageProps = {
  searchParams: Promise<{ brouillon?: string; etape?: string; reprendre?: string }>;
};

const stepFromQuery: Record<string, number> = {
  projet: 0,
  histoire: 1,
  options: 2,
  references: 3,
  compte: 4,
  recap: 5,
};

export default async function OrderPage({ searchParams }: OrderPageProps) {
  const actor = await orderActorFromHeaders(await headers());
  const query = await searchParams;
  const requestedDraft = query.brouillon;
  const draft = actor ? await getCommanderOrderForActor(actor, requestedDraft) : null;
  const initialStep = query.etape && query.etape in stepFromQuery ? stepFromQuery[query.etape] : 0;
  const paymentsAvailable = await paymentQaAvailable();

  return (
    <>
      <header className="page-hero page-hero--story">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Une histoire à confier</p>
            <h1>Ce qui compte pour vous peut devenir musique.</h1>
          </div>
          <div>
            <p className="page-hero__intro">Vous apportez l’histoire, les intentions et les repères. LNX Beats l’interprète, écrit et construit la création musicale.</p>
            <div className="page-hero__meta"><span>Création personnelle : 50 €</span><span>Délai indicatif : {orderOffer.indicativeDelay}</span></div>
          </div>
          <div className="page-hero__visual page-hero__visual--story" aria-hidden="true">
            <span>Votre récit</span>
          </div>
        </Container>
      </header>
      <section className="section editorial-break">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">La rencontre</p>
          <div className="editorial-copy">
            <p>Vous n’avez pas besoin d’apporter des paroles finales. Racontez les personnes, la scène et ce que la musique devra préserver.</p>
            <p>Préparez le brief librement, puis connectez-vous pour l’enregistrer. Le parcours reprend après l’authentification sans placer votre histoire dans l’URL.</p>
            <p>La demande initiale reste personnelle et son total ne dépasse pas 90 €. Une extension d’exploitation séparée ne peut être envisagée qu’après livraison.</p>
            <p>Le paiement Test s’ouvre uniquement après le récapitulatif, sur la page Checkout hébergée de Stripe. Le serveur reste la seule source du montant et de la confirmation.</p>
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="order-layout motion-reveal motion-reveal--soft">
          <MusicOrderForm
            account={actor ? { authenticated: true, name: actor.name, email: actor.email } : { authenticated: false }}
            initialDraft={draft}
            initialStep={initialStep}
            paymentsAvailable={paymentsAvailable}
          />
          <aside className="order-aside" aria-label="Règles de la création">
            <p className="eyebrow">Repères du projet</p>
            <p className="order-aside__price">Dès 50 €</p>
            <ul>
              <li>Création musicale et livraison WAV future</li>
              <li>Un retour conforme au brief initial inclus</li>
              <li>Cover personnalisée : +10 €</li>
              <li>Traitement prioritaire : +30 €</li>
              <li>Total maximum de la création : 90 €</li>
              <li>Droits d’exploitation exclus de cette première commande</li>
              <li>{paymentsAvailable ? "Checkout Stripe hébergé · mode Test" : "Paiement Test fermé dans cet environnement"}</li>
            </ul>
            <p className="order-aside__note">Après livraison, une demande distincte pourra ouvrir un échange sur les droits d’exploitation, selon contrat spécifique.</p>
          </aside>
        </Container>
      </section>
    </>
  );
}

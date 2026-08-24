import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";
import { orderOffer } from "@/data/order-offer";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { getCommanderOrderForActor } from "@/lib/orders/service";
import { paymentProvidersAvailable } from "@/lib/payments/availability";

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
  const resumeJourney = query.reprendre === "1" && !requestedDraft;
  const draft = actor && !resumeJourney ? await getCommanderOrderForActor(actor, requestedDraft) : null;
  const initialStep = resumeJourney ? 0 : query.etape && query.etape in stepFromQuery ? stepFromQuery[query.etape] : 0;
  const paymentProviders = await paymentProvidersAvailable();

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
            <p>La création personnelle est plafonnée à 90 €. Les droits d’exploitation pourront faire l’objet d’une demande distincte après livraison.</p>
            <p>Le paiement sera proposé après validation du récapitulatif lorsqu’un moyen de paiement est disponible. Le total est calculé par LNX Studio et le paiement n’est confirmé qu’après validation sécurisée.</p>
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="order-layout motion-reveal motion-reveal--soft">
          <MusicOrderForm
            account={actor ? { authenticated: true, name: actor.name, email: actor.email } : { authenticated: false }}
            initialDraft={draft}
            initialStep={initialStep}
            paymentProviders={paymentProviders}
            resumeJourney={resumeJourney}
          />
          <aside className="order-aside" aria-label="Règles de la création">
            <p className="eyebrow">Repères du projet</p>
            <p className="order-aside__price">Dès 50 €</p>
            <ul>
              <li>Création musicale avec livraison ultérieure du fichier WAV</li>
              <li>Une demande d’ajustement conforme au brief initial incluse</li>
              <li>Cover personnalisée : +10 €</li>
              <li>Traitement prioritaire : +30 €</li>
              <li>Total maximum de la création : 90 €</li>
              <li>Les droits d’exploitation font l’objet d’une demande distincte après livraison</li>
              <li>{paymentProviders.stripe || paymentProviders.paypal ? "Paiement sécurisé selon les moyens disponibles" : "Paiement temporairement indisponible"}</li>
            </ul>
            <p className="order-aside__note">Chaque demande de droits reste soumise à une étude et à un contrat spécifique.</p>
          </aside>
        </Container>
      </section>
    </>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";
import { orderOffer } from "@/data/order-offer";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { getDraftForActor } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confier une histoire",
  description: "Préparez, sauvegardez et suivez une demande de création musicale personnalisée avec LNX Beats.",
  alternates: { canonical: "/commander" },
};

type OrderPageProps = {
  searchParams: Promise<{ brouillon?: string }>;
};

export default async function OrderPage({ searchParams }: OrderPageProps) {
  const actor = await orderActorFromHeaders(await headers());
  const requestedDraft = (await searchParams).brouillon;
  const draft = actor ? await getDraftForActor(actor, requestedDraft) : null;

  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Une histoire à confier</p>
            <h1>Ce qui compte pour vous peut devenir musique.</h1>
          </div>
          <div>
            <p className="page-hero__intro">Vous apportez l’histoire, les intentions et les repères. LNX Beats l’interprète, écrit et construit la création musicale.</p>
            <div className="page-hero__meta"><span>Création personnelle : 50 €</span><span>Délai indicatif : {orderOffer.indicativeDelay}</span></div>
          </div>
        </Container>
      </header>
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">La rencontre</p>
          <div className="editorial-copy">
            <p>Vous n’avez pas besoin d’apporter des paroles finales. Racontez les personnes, la scène et ce que la musique devra préserver.</p>
            <p>Un compte vérifié est requis dès la première sauvegarde. Le brouillon reste privé et peut être repris depuis votre espace.</p>
            <p>La demande créée restera en attente de paiement : aucun paiement, contrat électronique ou engagement de réalisation n’est activé dans cette version.</p>
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="order-layout motion-reveal motion-reveal--soft">
          <MusicOrderForm
            account={actor ? { authenticated: true, name: actor.name } : { authenticated: false }}
            initialDraft={draft}
          />
          <aside className="order-aside" aria-label="Règles de la création">
            <p className="eyebrow">Repères du projet</p>
            <p className="order-aside__price">Dès 50 €</p>
            <ul>
              <li>Création musicale et livraison WAV future</li>
              <li>Un retour conforme au brief initial inclus</li>
              <li>Cover personnalisée : +10 €</li>
              <li>Traitement prioritaire : +30 €</li>
              <li>Commercial étendu : 1 500 € au total, hors options</li>
              <li>Paiement non encore disponible</li>
            </ul>
            <p className="order-aside__note">Traitement fiscal, droits détaillés et conditions d’annulation à valider avant activation commerciale.</p>
          </aside>
        </Container>
      </section>
    </>
  );
}

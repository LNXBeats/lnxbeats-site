
import { T } from "@/components/site-language";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";
import { orderOffer } from "@/data/order-offer";
import { getSiteLocale, serverMoney, serverT } from "@/lib/i18n/server";
import type { SiteLocale } from "@/lib/i18n/config";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { getCommanderOrderForActor } from "@/lib/orders/service";
import { paymentProvidersAvailable } from "@/lib/payments/availability";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import "../v084-commander.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  return createPublicPageMetadata({
  title: serverT(locale, "Création musicale personnalisée"),
  description: serverT(locale, "Confiez votre histoire à LNX Beats et préparez une création musicale personnalisée avec le parcours sécurisé de LNX STUDIO."),
  imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique."),
  pathname: "/commander",
  });
}

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

const maximumOrderPriceCents = orderOffer.personalBaseCents
  + orderOffer.coverCents
  + orderOffer.priorityCents;

function CommanderMeetingCopy({ paymentAvailable, locale }: { paymentAvailable: boolean; locale: SiteLocale }) {
  return (
    <div className="editorial-copy">
      <p><T text="Vous n’avez pas besoin d’apporter des paroles finales. Racontez les personnes, la scène et ce que la musique devra préserver."/></p>
      <p><T text="Préparez le brief librement, puis connectez-vous pour l’enregistrer. Le parcours reprend après l’authentification sans placer votre histoire dans l’URL."/></p>
      <p className="commander-meeting-v084__facts">
        <span><T text="Création musicale avec livraison ultérieure du fichier WAV."/></span>
        <span>{paymentAvailable ? <T text="Paiement sécurisé selon les moyens disponibles."/> : <T text="Paiement temporairement indisponible."/>}</span>
      </p>
      <p><T text="La création personnelle est plafonnée à"/> {serverMoney(locale, maximumOrderPriceCents)}. <T text="Les droits d’exploitation pourront faire l’objet d’une demande distincte après livraison."/></p>
      <p><T text="Le paiement sera proposé après validation du récapitulatif lorsqu’un moyen de paiement est disponible. Le total est calculé par LNX Studio et le paiement n’est confirmé qu’après validation sécurisée."/></p>
    </div>
  );
}

export default async function OrderPage({ searchParams }: OrderPageProps) {
  const locale = await getSiteLocale();
  const actor = await orderActorFromHeaders(await headers());
  const query = await searchParams;
  const requestedDraft = query.brouillon;
  const resumeJourney = query.reprendre === "1" && !requestedDraft;
  const draft = actor && !resumeJourney ? await getCommanderOrderForActor(actor, requestedDraft) : null;
  const initialStep = resumeJourney ? 0 : query.etape && query.etape in stepFromQuery ? stepFromQuery[query.etape] : 0;
  const paymentProviders = await paymentProvidersAvailable();
  const paymentAvailable = paymentProviders.stripe || paymentProviders.paypal;

  return (
    <>
      <header className="page-hero page-hero--story commander-hero-v084" data-motion-scene="commander">
        <div className="commander-hero-v2__backdrop" aria-hidden="true" data-motion-layer="media" />
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow"><T text="Une histoire à confier"/></p>
            <h1><T text="Commander une création"/>.</h1>
          </div>
          <div>
            <p className="page-hero__intro"><T text="Vous apportez l’histoire, les intentions et les repères. LNX Beats l’interprète, écrit et construit la création musicale."/></p>
            <div className="page-hero__meta"><span><T text="Création personnelle :"/> {serverMoney(locale, orderOffer.personalBaseCents)}</span><span><T text="Délai indicatif :"/> {serverT(locale, orderOffer.indicativeDelay)}</span></div>
          </div>
          <div className="page-hero__visual page-hero__visual--story" aria-hidden="true">
            <span><T text="Votre récit"/></span>
          </div>
        </Container>
      </header>
      <section className="section commander-order-section-v084">
        <Container className="order-layout commander-v084 motion-reveal motion-reveal--soft">
          <MusicOrderForm
            account={actor ? { authenticated: true, name: actor.name, email: actor.email } : { authenticated: false }}
            initialDraft={draft}
            initialStep={initialStep}
            paymentProviders={paymentProviders}
            resumeJourney={resumeJourney}
          />
        </Container>
      </section>
      <section className="section editorial-break commander-meeting-v084">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label commander-meeting-v084__desktop"><T text="Comment ça marche ?"/></p>
          <div className="commander-meeting-v084__desktop">
            <CommanderMeetingCopy paymentAvailable={paymentAvailable} locale={locale} />
          </div>
          <details className="commander-meeting-v084__details commander-meeting-v084__mobile">
            <summary><T text="Comment ça marche"/></summary>
            <CommanderMeetingCopy paymentAvailable={paymentAvailable} locale={locale} />
          </details>
        </Container>
      </section>
    </>
  );
}

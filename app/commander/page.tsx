import type { Metadata } from "next";
import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";

export const metadata: Metadata = {
  title: "Commander une musique",
  description: "Préparez votre projet de musique personnalisée avec LNX Beats : 50 €, délai indicatif de 7 jours.",
  alternates: { canonical: "/commander" },
};

export default function OrderPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Création personnalisée</p>
            <h1>Votre histoire. Votre musique.</h1>
          </div>
          <div>
            <p className="page-hero__intro">Préparez le brief qui permettra à LNX Beats de comprendre votre histoire, son intention et sa couleur musicale. Ce parcours reste une simulation locale.</p>
            <div className="page-hero__meta"><span>50 €</span><span>Délai indicatif : 7 jours</span></div>
          </div>
        </Container>
      </header>
      <section className="section section--soft">
        <Container className="content-columns">
          <p className="content-columns__label">Le principe</p>
          <div className="editorial-copy">
            <p>Vous apportez l’histoire. LNX Beats cherche la voix, le rythme et le décor musical qui peuvent la faire vivre.</p>
            <p>Le parcours ci-dessous aide à structurer un brief : personnes, souvenirs, éléments indispensables, tonalité et usage envisagé. Il ne transmet, n’enregistre et ne facture rien.</p>
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="order-layout">
          <MusicOrderForm />
          <aside className="order-aside" aria-label="Informations tarifaires">
            <p className="eyebrow">Musique personnalisée</p>
            <p className="order-aside__price">50 €</p>
            <p>Un parcours guidé pour poser votre histoire, votre intention et votre direction musicale.</p>
            <ul>
              <li>Délai indicatif de 7 jours</li>
              <li>Style au choix ou confié à LNX Beats</li>
              <li>Usage personnel envisagé</li>
              <li>Droits commerciaux à cadrer séparément</li>
              <li>Paiement non activé</li>
            </ul>
          </aside>
        </Container>
      </section>
    </>
  );
}

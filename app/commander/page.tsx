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
            <p className="page-hero__intro">Préparez le brief qui permettra à LNX Beats de transformer votre histoire en chanson. Cette première version est uniquement visuelle.</p>
            <div className="page-hero__meta"><span>50 €</span><span>Délai indicatif : 7 jours</span></div>
          </div>
        </Container>
      </header>
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
              <li>Usage personnel préparé</li>
              <li>Droits commerciaux à cadrer séparément</li>
              <li>Paiement non activé</li>
            </ul>
          </aside>
        </Container>
      </section>
    </>
  );
}

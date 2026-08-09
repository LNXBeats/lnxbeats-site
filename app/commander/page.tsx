import type { Metadata } from "next";
import { Container } from "@/components/container";
import { MusicOrderForm } from "@/components/music-order-form";

export const metadata: Metadata = {
  title: "Confier une histoire",
  description: "Confiez une histoire à LNX Beats et préparez les premiers éléments d’une création musicale personnalisée.",
  alternates: { canonical: "/commander" },
};

export default function OrderPage() {
  return (
    <>
      <header className="page-hero">
        <Container className="page-hero__grid">
          <div>
            <p className="eyebrow">Une histoire à confier</p>
            <h1>Ce qui compte pour vous peut devenir musique.</h1>
          </div>
          <div>
            <p className="page-hero__intro">Tout commence par une rencontre : vous apportez les souvenirs, les personnes et les mots. LNX Beats cherche la forme musicale capable de les faire vivre.</p>
            <div className="page-hero__meta"><span>50 €</span><span>Délai indicatif : 7 jours</span></div>
          </div>
        </Container>
      </header>
      <section className="section section--soft">
        <Container className="content-columns">
          <p className="content-columns__label">La rencontre</p>
          <div className="editorial-copy">
            <p>Vous n’avez pas besoin d’écrire une chanson. Vous avez seulement besoin de raconter ce qui ne doit pas être perdu.</p>
            <p>Les étapes suivantes donnent un ordre aux souvenirs, aux émotions et aux repères utiles. Rien n’est transmis, enregistré ou facturé dans cette version.</p>
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="order-layout">
          <MusicOrderForm />
          <aside className="order-aside" aria-label="Informations tarifaires">
            <p className="eyebrow">Ce que vous confiez</p>
            <p className="order-aside__price">50 €</p>
            <p>Un récit personnel, ses détails essentiels et la couleur que vous imaginez — ou le choix de laisser LNX Beats la trouver.</p>
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

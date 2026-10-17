import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/container";

export const metadata: Metadata = {
  title: "Conditions générales",
  description: "Conditions générales distinctes pour les créations musicales, les produits physiques et les achats de musique numérique LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv" },
};

export default function TermsIndexPage() {
  return (
    <section className="legal-index">
      <Container>
        <p className="eyebrow">Conditions générales</p>
        <h1>Les conditions adaptées à votre achat.</h1>
        <p className="legal-index__lead">Création personnalisée, bien physique et téléchargement musical répondent à des règles distinctes. Choisissez le document correspondant à votre commande.</p>
        <div className="legal-index__cards">
          <article>
            <p className="eyebrow">Création musicale</p>
            <h2>Prestation et livrable numérique</h2>
            <p>Prestation créative sur commande, livrable numérique, commencement anticipé et droit de rétractation.</p>
            <Link className="button button--secondary" href="/cgv/creation-musicale">Consulter les conditions</Link>
          </article>
          <article>
            <p className="eyebrow">Boutique physique</p>
            <h2>Produits, livraison et garanties</h2>
            <p>Stock, paiement, livraison, transfert des risques, rétractation, retours et garanties légales.</p>
            <Link className="button button--secondary" href="/cgv/boutique">Consulter les conditions</Link>
          </article>
          <article>
            <p className="eyebrow">Achat de musique numérique</p>
            <h2>Titres et albums à télécharger</h2>
            <p>Formats WAV et MP3, usage privé, fourniture immédiate, rétractation et garanties légales.</p>
            <Link className="button button--secondary" href="/musique/conditions">Consulter les CGV numériques</Link>
          </article>
        </div>
      </Container>
    </section>
  );
}

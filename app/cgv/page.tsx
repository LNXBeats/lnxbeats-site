import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/container";

export const metadata: Metadata = {
  title: "Conditions générales",
  description: "Conditions générales distinctes pour les créations musicales et les produits physiques LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv" },
};

export default function TermsIndexPage() {
  return (
    <section className="legal-index">
      <Container>
        <p className="eyebrow">Conditions générales</p>
        <h1>Deux contrats, deux cadres distincts.</h1>
        <p className="legal-index__lead">Une création musicale personnalisée et l’achat d’un bien physique répondent à des règles distinctes. Choisissez le document correspondant à votre commande.</p>
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
        </div>
      </Container>
    </section>
  );
}

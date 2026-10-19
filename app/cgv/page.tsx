
import { T, ContractLanguageNotice } from "@/components/site-language";
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
        <p className="eyebrow"><T text="Conditions générales" /></p>
        <ContractLanguageNotice/>
        <h1><T text="Les conditions adaptées à votre achat." /></h1>
        <p className="legal-index__lead"><T text="Création personnalisée, bien physique et téléchargement musical répondent à des règles distinctes. Choisissez le document correspondant à votre commande." /></p>
        <div className="legal-index__cards">
          <article>
            <p className="eyebrow"><T text="Création musicale"/></p>
            <h2><T text="Prestation et livrable numérique" /></h2>
            <p><T text="Prestation créative sur commande, livrable numérique, commencement anticipé et droit de rétractation." /></p>
            <Link className="button button--secondary" href="/cgv/creation-musicale"><T text="Consulter les conditions" /></Link>
          </article>
          <article>
            <p className="eyebrow"><T text="Boutique physique" /></p>
            <h2><T text="Produits, livraison et garanties" /></h2>
            <p><T text="Stock, paiement, livraison, transfert des risques, rétractation, retours et garanties légales." /></p>
            <Link className="button button--secondary" href="/cgv/boutique"><T text="Consulter les conditions" /></Link>
          </article>
          <article>
            <p className="eyebrow"><T text="Achat de musique numérique" /></p>
            <h2><T text="Titres et albums à télécharger" /></h2>
            <p><T text="Formats WAV et MP3, usage privé, fourniture immédiate, rétractation et garanties légales." /></p>
            <Link className="button button--secondary" href="/musique/conditions"><T text="Consulter les CGV numériques"/></Link>
          </article>
        </div>
      </Container>
    </section>
  );
}

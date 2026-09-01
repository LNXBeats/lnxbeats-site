import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/container";
import { phase4cMusicTermsCandidate, releaseBShopTermsCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Conditions générales",
  description: "Versions candidates distinctes pour les créations musicales et les produits physiques LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv" },
};

export default function TermsIndexPage() {
  return (
    <section className="legal-index">
      <Container>
        <p className="eyebrow">Version candidate — revue humaine obligatoire</p>
        <h1>Deux contrats, deux cadres distincts.</h1>
        <p className="legal-index__lead">Une création musicale personnalisée et l’achat d’un bien physique ne partagent pas automatiquement les mêmes règles. Les versions ci-dessous restent non approuvées et non actives.</p>
        <div className="legal-index__cards">
          <article>
            <p className="eyebrow">Création musicale</p>
            <h2>Prestation et livrable numérique</h2>
            <p>Prestation créative sur commande, livrable numérique, commencement anticipé et rétractation soumis à revue juridique.</p>
            <dl><div><dt>Version</dt><dd>{phase4cMusicTermsCandidate.version}</dd></div><div><dt>Statut</dt><dd>{phase4cMusicTermsCandidate.status}</dd></div></dl>
            <Link className="button button--secondary" href="/cgv/creation-musicale">Lire la version candidate</Link>
          </article>
          <article>
            <p className="eyebrow">Boutique physique</p>
            <h2>Produits, livraison et garanties</h2>
            <p>Stock, paiement, livraison, transfert des risques, rétractation, retours et garanties légales.</p>
            <dl><div><dt>Version</dt><dd>{releaseBShopTermsCandidate.version}</dd></div><div><dt>Statut</dt><dd>{releaseBShopTermsCandidate.status}</dd></div></dl>
            <Link className="button button--secondary" href="/cgv/boutique">Lire la version candidate</Link>
          </article>
        </div>
        <p className="legal-document__warning" role="note">La version technique <code>shop-cgv-phase3-qa-v1</code> demeure exclusivement réservée à la QA locale et ne peut pas être activée en Production.</p>
      </Container>
    </section>
  );
}

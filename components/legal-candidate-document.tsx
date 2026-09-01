import Link from "next/link";

import { Container } from "@/components/container";
import { consumerMediatorInformation, type LegalCandidate } from "@/data/legal";
import { publicLegalDocument } from "@/lib/legal/public-document";

export function LegalCandidateDocument({ document, introduction }: { document: LegalCandidate; introduction: string }) {
  const content = publicLegalDocument(document);
  return (
    <article className="legal-document">
      <Container className="legal-document__container">
        <header className="legal-document__header">
          <p className="eyebrow">Informations juridiques</p>
          <h1>{content.title}</h1>
          <p className="legal-document__lead">{introduction}</p>
        </header>
        <nav className="legal-document__navigation" aria-label="Documents juridiques associés">
          <Link href="/cgv">Vue d’ensemble</Link>
          <Link href="/cgv/creation-musicale">Création musicale</Link>
          <Link href="/cgv/boutique">Boutique</Link>
          <Link href="/confidentialite">Confidentialité</Link>
          <Link href="/retractation">Rétractation</Link>
        </nav>
        <div className="legal-document__sections">
          {content.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <footer className="legal-document__footer">
          <p>Une réclamation préalable peut être adressée à <a href="mailto:lnx.beats.pro@gmail.com">lnx.beats.pro@gmail.com</a>.</p>
          <p><Link href="/retractation">Exercer mon droit de rétractation</Link> · <a href={`tel:${consumerMediatorInformation.phoneE164}`}>{consumerMediatorInformation.phone}</a> · <a href={consumerMediatorInformation.website} target="_blank" rel="noopener noreferrer">Médiateur CM2C</a></p>
        </footer>
      </Container>
    </article>
  );
}

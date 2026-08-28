import Link from "next/link";

import { Container } from "@/components/container";
import type { LegalCandidate } from "@/data/legal";

export function LegalCandidateDocument({ document, introduction }: { document: LegalCandidate; introduction: string }) {
  return (
    <article className="legal-document">
      <Container className="legal-document__container">
        <header className="legal-document__header">
          <p className="eyebrow">Version candidate — revue humaine obligatoire</p>
          <h1>{document.title}</h1>
          <p className="legal-document__lead">{introduction}</p>
          <dl className="legal-document__metadata" aria-label="Statut du document">
            <div><dt>Version</dt><dd>{document.version}</dd></div>
            <div><dt>Statut</dt><dd>{document.status}</dd></div>
            <div><dt>Empreinte</dt><dd><code>{document.hashSha256.slice(0, 12)}…</code></dd></div>
            <div><dt>Date d’effet</dt><dd>Non définie</dd></div>
          </dl>
          <p className="legal-document__warning" role="note">Ce texte n’est ni approuvé ni actif en Production. Les mentions marquées ci-dessous doivent être tranchées par les professionnels compétents.</p>
        </header>
        <nav className="legal-document__navigation" aria-label="Documents juridiques associés">
          <Link href="/cgv">Vue d’ensemble</Link>
          <Link href="/cgv/creation-musicale">Création musicale</Link>
          <Link href="/cgv/boutique">Boutique</Link>
          <Link href="/confidentialite">Confidentialité</Link>
          <Link href="/retractation">Rétractation</Link>
        </nav>
        <div className="legal-document__sections">
          {document.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.decisions?.length ? (
                <ul className="legal-document__decisions" aria-label="Décisions encore requises">
                  {section.decisions.map((decision) => (
                    <li key={`${decision.category}:${decision.code}`}><strong>{decision.category}</strong><code>{decision.code}</code></li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
        <footer className="legal-document__footer">
          <p>Une réclamation préalable peut être adressée à <a href="mailto:lnx.beats.pro@gmail.com">lnx.beats.pro@gmail.com</a>.</p>
          <p><Link href="/retractation">Exercer mon droit de rétractation</Link> · <a href="https://www.cm2c.net/" target="_blank" rel="noopener noreferrer">Médiateur CM2C</a></p>
        </footer>
      </Container>
    </article>
  );
}

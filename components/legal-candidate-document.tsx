
import { T, ContractLanguageNotice } from "@/components/site-language";
import { getSiteLocale, serverT } from "@/lib/i18n/server";
import Link from "next/link";

import { Container } from "@/components/container";
import { consumerMediatorInformation, type LegalCandidate } from "@/data/legal";
import { publicLegalDocument } from "@/lib/legal/public-document";

export async function LegalCandidateDocument({ document, introduction }: { document: LegalCandidate; introduction: string }) {
  const locale = await getSiteLocale();
  const content = publicLegalDocument(document);
  return (
    <article className="legal-document">
      <Container className="legal-document__container">
        <header className="legal-document__header">
          <p className="eyebrow"><T text="Informations juridiques" /></p>
          <h1 lang="fr" translate="no">{content.title}</h1>
          <p className="legal-document__lead"><T text={introduction}/></p>
          <ContractLanguageNotice/>
        </header>
        <nav className="legal-document__navigation" aria-label={serverT(locale, "Documents juridiques associés")}>
          <Link href="/cgv"><T text="Vue d’ensemble" /></Link>
          <Link href="/cgv/creation-musicale"><T text="Création musicale" /></Link>
          <Link href="/cgv/boutique"><T text="Boutique" /></Link>
          <Link href="/confidentialite"><T text="Confidentialité" /></Link>
          <Link href="/retractation"><T text="Rétractation" /></Link>
        </nav>
        <div className="legal-document__sections" lang="fr" translate="no">
          {content.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <footer className="legal-document__footer">
          <p lang="fr" translate="no">Une réclamation préalable peut être adressée à <a href="mailto:lnx.beats.pro@gmail.com">lnx.beats.pro@gmail.com</a>.</p>
          <p><Link href="/retractation"><T text="Exercer mon droit de rétractation" /></Link> · <a href={`tel:${consumerMediatorInformation.phoneE164}`}>{consumerMediatorInformation.phone}</a> · <a href={consumerMediatorInformation.website} target="_blank" rel="noopener noreferrer"><T text="Médiateur CM2C" /></a></p>
        </footer>
      </Container>
    </article>
  );
}

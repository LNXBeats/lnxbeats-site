import type { Metadata } from "next";

import { Container } from "@/components/container";
import { WithdrawalForm } from "@/components/withdrawal-form";
import { phase4cWithdrawalNoticeCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Exercer mon droit de rétractation",
  description: "Fonctionnalité en ligne candidate pour notifier une demande de rétractation à LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/retractation" },
};

export default function WithdrawalPage() {
  return (
    <section className="withdrawal-page">
      <Container className="withdrawal-page__container">
        <header>
          <p className="eyebrow">Fonctionnalité en ligne — version candidate</p>
          <h1>Exercer mon droit de rétractation</h1>
          <p>Lorsque ce droit s’applique, vous pouvez notifier votre décision ici, sans connexion obligatoire et sans avoir à fournir de motif.</p>
          <p className="legal-document__warning" role="note">Le formulaire enregistre une déclaration et son heure de réception. Il ne décide pas automatiquement de son éligibilité et ne déclenche aucun remboursement.</p>
          <dl className="legal-document__metadata"><div><dt>Notice</dt><dd>{phase4cWithdrawalNoticeCandidate.version}</dd></div><div><dt>Statut</dt><dd>{phase4cWithdrawalNoticeCandidate.status}</dd></div></dl>
        </header>
        <div className="legal-document__sections withdrawal-page__information" aria-label="Information candidate sur la rétractation">
          {phase4cWithdrawalNoticeCandidate.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.decisions?.length ? (
                <ul className="legal-document__decisions" aria-label="Décisions encore soumises à revue juridique">
                  {section.decisions.map((decision) => (
                    <li key={`${decision.category}:${decision.code}`}><strong>{decision.category}</strong><code>{decision.code}</code></li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
        <WithdrawalForm />
      </Container>
    </section>
  );
}

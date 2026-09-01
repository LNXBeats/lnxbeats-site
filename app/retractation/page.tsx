import type { Metadata } from "next";

import { Container } from "@/components/container";
import { WithdrawalForm } from "@/components/withdrawal-form";
import { approvedWithdrawalNotice } from "@/data/legal";
import { publicLegalDocument } from "@/lib/legal/public-document";

export const metadata: Metadata = {
  title: "Exercer mon droit de rétractation",
  description: "Fonctionnalité en ligne pour notifier une demande de rétractation à LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/retractation" },
};

export default function WithdrawalPage() {
  const notice = publicLegalDocument(approvedWithdrawalNotice);
  return (
    <section className="withdrawal-page">
      <Container className="withdrawal-page__container">
        <header>
          <p className="eyebrow">Démarche en ligne</p>
          <h1>Exercer mon droit de rétractation</h1>
          <p>Lorsque ce droit s’applique, vous pouvez notifier votre décision ici, sans connexion obligatoire et sans avoir à fournir de motif.</p>
          <p className="legal-document__warning" role="note">Le formulaire enregistre une déclaration et son heure de réception. Il ne décide pas automatiquement de son éligibilité et ne déclenche aucun remboursement.</p>
        </header>
        <div className="legal-document__sections withdrawal-page__information" aria-label="Informations sur la rétractation">
          {notice.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <WithdrawalForm />
      </Container>
    </section>
  );
}

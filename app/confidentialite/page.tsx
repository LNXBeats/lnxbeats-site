import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { finalPrivacyCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Politique de confidentialité de LNX Beats et LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  return <LegalCandidateDocument document={finalPrivacyCandidate} introduction="Informations sur les données traitées, leurs finalités, leurs destinataires, leurs durées de conservation et vos droits." />;
}

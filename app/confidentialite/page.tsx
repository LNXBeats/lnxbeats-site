import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { phase4bPrivacyCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Politique de confidentialité candidate de LNX Beats et LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  return <LegalCandidateDocument document={phase4bPrivacyCandidate} introduction="Cartographie candidate des données, finalités, bases légales, destinataires, durées, cookies et droits." />;
}

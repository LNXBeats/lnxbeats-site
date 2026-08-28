import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { privacyCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Politique de confidentialité candidate de LNX Beats et LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  return <LegalCandidateDocument document={privacyCandidate} introduction="Cartographie candidate des données, finalités, bases légales, destinataires, durées, cookies et droits." />;
}

import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { phase4bMusicTermsCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "CGV créations musicales",
  description: "Conditions générales candidates pour les créations musicales personnalisées LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv/creation-musicale" },
};

export default function MusicTermsPage() {
  return <LegalCandidateDocument document={phase4bMusicTermsCandidate} introduction="Cadre candidat des créations musicales personnalisées, sans activation juridique ni transfert automatique de droits." />;
}

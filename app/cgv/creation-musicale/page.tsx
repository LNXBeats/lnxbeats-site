import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { finalMusicTermsCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "CGV créations musicales",
  description: "Conditions générales pour les créations musicales personnalisées LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv/creation-musicale" },
};

export default function MusicTermsPage() {
  return <LegalCandidateDocument document={finalMusicTermsCandidate} introduction="Conditions applicables aux créations musicales personnalisées, à leur réalisation, à leur livraison et aux droits associés." />;
}

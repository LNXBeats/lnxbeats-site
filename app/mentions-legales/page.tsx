import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { legalNoticesCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: "Mentions légales candidates de LNX Beats et du service LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/mentions-legales" },
};

export default function LegalNoticePage() {
  return <LegalCandidateDocument document={legalNoticesCandidate} introduction="Identité de l’éditeur, activité, hébergement, propriété intellectuelle, réclamation et médiation." />;
}

import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { shopTermsCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "CGV Boutique",
  description: "Conditions générales candidates de la Boutique physique LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv/boutique" },
};

export default function ShopTermsPage() {
  return <LegalCandidateDocument document={shopTermsCandidate} introduction="Cadre candidat des ventes de produits physiques, à compléter après décisions juridiques, comptables et logistiques." />;
}

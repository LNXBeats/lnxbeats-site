import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { phase4cShopTermsCandidate } from "@/data/legal";

export const metadata: Metadata = {
  title: "CGV Boutique",
  description: "Conditions générales candidates de la Boutique physique LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv/boutique" },
};

export default function ShopTermsPage() {
  return <LegalCandidateDocument document={phase4cShopTermsCandidate} introduction="Cadre candidat des ventes de produits physiques consolidant les décisions fiscales et logistiques, toujours soumis à revue juridique humaine." />;
}

import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { approvedShopTerms } from "@/data/legal";

export const metadata: Metadata = {
  title: "CGV Boutique",
  description: "Conditions générales de la Boutique physique LNX Beats.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/cgv/boutique" },
};

export default function ShopTermsPage() {
  return <LegalCandidateDocument document={approvedShopTerms} introduction="Conditions applicables à la vente, au paiement, à la livraison, aux retours et aux garanties des produits physiques." />;
}

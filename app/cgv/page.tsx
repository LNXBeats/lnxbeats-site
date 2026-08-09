import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Conditions générales de vente", robots: { index: false, follow: true }, alternates: { canonical: "/cgv" } };

export default function TermsPage() {
  return <LegalPlaceholder title="Conditions de vente" description="Les modalités de commande, de paiement, de rétractation, de livraison et de droits d’usage restent à valider juridiquement." />;
}

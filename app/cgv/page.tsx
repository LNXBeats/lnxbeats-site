import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Conditions générales de vente", robots: { index: false, follow: true }, alternates: { canonical: "/cgv" } };

export default function TermsPage() {
  return (
    <LegalPlaceholder
      title="Conditions de vente"
      description="Aucune commande ni aucun paiement n’est actif sur ce site. Ces rubriques doivent être rédigées et validées avant l’ouverture d’une offre commerciale."
      sections={[
        {
          title: "Offre et réalisation",
          items: [
            { status: "À FOURNIR", text: "Identité du vendeur et champ d’application des conditions." },
            { status: "À FOURNIR", text: "Description exacte de la prestation et du livrable musical." },
            { status: "À VALIDER", text: "Prix, taxes, devis, durée de validité et conditions de révision tarifaire." },
            { status: "À VALIDER", text: "Calendrier, étapes de validation, nombre de retours et conditions de livraison." },
            { status: "À VALIDER", text: "Droits d’usage personnel, licences commerciales et propriété intellectuelle." },
          ],
        },
        {
          title: "Commande, paiement et litiges",
          items: [
            { status: "À VALIDER", text: "Moment de formation de la commande, preuve de l’accord et gestion des modifications." },
            { status: "À VALIDER", text: "Rétractation, annulation, remboursement et exceptions applicables aux créations personnalisées." },
            { status: "À VALIDER", text: "Paiement futur par PayPal : confirmation serveur, échéance, frais et gestion des incidents." },
            { status: "À VALIDER", text: "Paiement futur par virement : transmission sécurisée du RIB, référence et rapprochement." },
            { status: "À FOURNIR", text: "Règles de facturation, médiateur de la consommation et juridiction compétente." },
          ],
        },
      ]}
    />
  );
}

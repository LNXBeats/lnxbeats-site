import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";
import { orderOffer } from "@/data/order-offer";

export const metadata: Metadata = { title: "Conditions générales de vente", robots: { index: false, follow: true }, alternates: { canonical: "/cgv" } };

export default function TermsPage() {
  return (
    <LegalPlaceholder
      title="Conditions de vente"
      description="Le site peut désormais enregistrer une demande et son prix de référence, mais aucun paiement n’est actif. Ces rubriques restent préparatoires et doivent être juridiquement et fiscalement validées avant toute ouverture commerciale."
      sections={[
        {
          title: "Offre et réalisation",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: "Vendeur annoncé : Ludovic Mathon, entrepreneur individuel, sous le nom artistique LNX Beats." },
            { status: "À FOURNIR", text: "Description exacte de la prestation et du livrable musical." },
            { status: "DÉJÀ IDENTIFIÉ", text: `Références enregistrées : usage personnel ${(orderOffer.personalBaseCents / 100).toLocaleString("fr-FR")} €, exploitation commerciale étendue ${(orderOffer.commercialExtendedBaseCents / 100).toLocaleString("fr-FR")} €, cover +${orderOffer.coverCents / 100} €, priorité +${orderOffer.priorityCents / 100} €.` },
            { status: "À VALIDER", text: "Taxes, devis, durée de validité, conditions de révision tarifaire et régime de TVA applicable." },
            { status: "À VALIDER", text: "Calendrier, étapes de validation et livraison. Une demande de retour est prévue dans le modèle, sans délai contractuel annoncé." },
            { status: "À VALIDER", text: "Droits d’usage personnel, licences commerciales et propriété intellectuelle." },
            { status: "DÉJÀ IDENTIFIÉ", text: "L’exploitation commerciale étendue exige un contrat spécifique. Aucune cession automatique des droits moraux ni aucune affiliation SACEM ne sont affirmées." },
          ],
        },
        {
          title: "Commande, paiement et litiges",
          items: [
            { status: "À VALIDER", text: "Moment de formation de la commande, preuve de l’accord et gestion des modifications." },
            { status: "À VALIDER", text: "Rétractation, annulation, remboursement et exceptions applicables aux créations personnalisées." },
            { status: "À VALIDER", text: "Architecture future des paiements : confirmation serveur, idempotence, échéance, frais et gestion des incidents. Aucun moyen de paiement n’est encore sélectionné ni simulé." },
            { status: "À VALIDER", text: "Paiement futur par virement : transmission sécurisée du RIB, référence et rapprochement." },
            { status: "À FOURNIR", text: "Règles de facturation, médiateur de la consommation et juridiction compétente." },
            { status: "À VALIDER", text: "Activation du service avant fin du délai de rétractation, preuve du consentement et conséquences d’une annulation d’une création personnalisée." },
          ],
        },
      ]}
    />
  );
}

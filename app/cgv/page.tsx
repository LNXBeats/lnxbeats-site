import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";
import { orderOffer } from "@/data/order-offer";
import { rightsOffers } from "@/data/rights-offer";
import { formatEuro } from "@/lib/orders/domain";

export const metadata: Metadata = { title: "Conditions générales de vente", robots: { index: false, follow: true }, alternates: { canonical: "/cgv" } };

const maximumOrderPriceCents = orderOffer.personalBaseCents
  + orderOffer.coverCents
  + orderOffer.priorityCents;

export default function TermsPage() {
  return (
    <LegalPlaceholder
      title="Conditions de vente"
      description="Le site enregistre une demande, son prix de référence et, lorsqu’un moyen est disponible, son paiement sécurisé. Les rubriques juridiques et fiscales signalées ci-dessous restent à valider."
      sections={[
        {
          title: "Offre et réalisation",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: "Vendeur annoncé : Ludovic Mathon, entrepreneur individuel, sous le nom artistique LNX Beats." },
            { status: "À FOURNIR", text: "Description exacte de la prestation et du livrable musical." },
            { status: "DÉJÀ IDENTIFIÉ", text: `Commande initiale personnelle : ${formatEuro(orderOffer.personalBaseCents)}, illustration personnalisée +${formatEuro(orderOffer.coverCents)}, priorité +${formatEuro(orderOffer.priorityCents)}, soit ${formatEuro(maximumOrderPriceCents)} maximum.` },
            { status: "DÉJÀ IDENTIFIÉ", text: `Après livraison uniquement, une licence de publication peut être demandée au tarif cible de ${(rightsOffers.PUBLICATION_LICENSE.priceCents / 100).toLocaleString("fr-FR")} € ou un partenariat d’exploitation au tarif cible de ${(rightsOffers.EXPLOITATION_PARTNERSHIP.priceCents / 100).toLocaleString("fr-FR")} €. Aucun paiement de droits n’est ouvert avant revue juridique.` },
            { status: "À VALIDER", text: "Taxes, devis, durée de validité, conditions de révision tarifaire et régime de TVA applicable." },
            { status: "À VALIDER", text: "Calendrier, étapes de validation et livraison. Une demande de retour est prévue dans le modèle, sans délai contractuel annoncé." },
            { status: "À VALIDER", text: "Droits d’usage personnel, licences commerciales et propriété intellectuelle." },
            { status: "DÉJÀ IDENTIFIÉ", text: "L’extension commerciale exige un contrat spécifique. Le droit moral reste hors du dispositif et aucune part SACEM n’est attribuée automatiquement." },
          ],
        },
        {
          title: "Commande, paiement et litiges",
          items: [
            { status: "À VALIDER", text: "Moment de formation de la commande, preuve de l’accord et gestion des modifications." },
            { status: "À VALIDER", text: "Rétractation, annulation, remboursement et exceptions applicables aux créations personnalisées." },
            { status: "À VALIDER", text: "Architecture des paiements : confirmation serveur, idempotence, échéance, frais et gestion des incidents. Les moyens disponibles sont présentés au moment du Checkout selon leur activation." },
            { status: "À VALIDER", text: "Paiement futur par virement : transmission sécurisée du RIB, référence et rapprochement." },
            { status: "À FOURNIR", text: "Règles de facturation, médiateur de la consommation et juridiction compétente." },
            { status: "À VALIDER", text: "Activation du service avant fin du délai de rétractation, preuve du consentement et conséquences d’une annulation d’une création personnalisée." },
          ],
        },
      ]}
    />
  );
}

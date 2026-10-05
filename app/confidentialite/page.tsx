import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { approvedPrivacyNotice } from "@/data/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Politique de confidentialité de LNX Beats et LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  return <><LegalCandidateDocument document={approvedPrivacyNotice} introduction="Informations sur les données traitées, leurs finalités, leurs destinataires, leurs durées de conservation et vos droits." /><section className="container"><h2>Votre soutien à LNX Beats</h2><p>L’e-mail facultatif sert uniquement à envoyer la confirmation demandée. Le message facultatif est destiné à LNX Beats et reste dans son registre privé. Aucune inscription newsletter ni utilisation marketing n’en découle. Ces données suivent les règles de conservation et d’exercice des droits décrites ci-dessus pour la gestion des versements et leurs justificatifs. Les coordonnées nécessaires à la livraison des e-mails sont transmises au prestataire d’e-mail transactionnel ; le message n’est pas envoyé aux prestataires de paiement.</p></section></>;
}

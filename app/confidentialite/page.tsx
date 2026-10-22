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
  return <>
    <LegalCandidateDocument document={approvedPrivacyNotice} introduction="Informations sur les données traitées, leurs finalités, leurs destinataires, leurs durées de conservation et vos droits." />
    <section className="container" lang="fr" translate="no">
      <h2>Votre soutien à LNX Beats</h2>
      <p>L’e-mail facultatif sert uniquement à envoyer la confirmation demandée. Le message facultatif est destiné à LNX Beats et reste dans son registre privé. Aucune inscription newsletter ni utilisation marketing n’en découle. Ces données suivent les règles de conservation et d’exercice des droits décrites ci-dessus pour la gestion des versements et leurs justificatifs. Les coordonnées nécessaires à la livraison des e-mails sont transmises au prestataire d’e-mail transactionnel ; le message n’est pas envoyé aux prestataires de paiement.</p>
    </section>
    <section className="container" lang="fr" translate="no">
      <h2>Avant-premières et alertes nouveautés facultatives</h2>
      <p>La création d’un compte n’inscrit pas automatiquement aux alertes. Vous choisissez séparément de recevoir par e-mail les nouveaux titres et albums, les produits de la Boutique, ou les actualités et créations. Les cases sont décochées par défaut. Le choix enregistré, sa date et sa version sont conservés pour respecter vos préférences et en justifier la prise en compte. Les règles de conservation des données du compte et l’exercice de vos droits décrits ci-dessus restent applicables.</p>
      <p>Vous pouvez retirer votre accord depuis Compte ou le lien de désinscription présent dans chaque alerte, sans perdre votre compte, vos achats ni l’accès aux avant-premières publiées pour les membres. Les confirmations de commande et les messages nécessaires à la sécurité restent distincts. En cas d’activation des alertes, l’adresse destinataire et le contenu du message sont transmis au prestataire d’e-mail Resend ; les préférences ne sont pas communiquées aux prestataires de paiement.</p>
      <h2>Vos avis sur les avant-premières</h2>
      <p>Le sondage facultatif associe un avis modifiable ou retirable à votre compte et à la version exacte présentée. Les autres membres et l’Administration voient des résultats agrégés, pas une liste publique de votants. Un avis ne déclenche ni achat, ni envoi d’e-mail, ni publication. Il ne constitue pas une attestation d’écoute ou de droits. Les règles de conservation et d’exercice des droits du compte restent applicables.</p>
      <h2>Date de dernière connexion</h2>
      <p>La date et l’heure d’une connexion authentifiée réussie peuvent être consultées par les administrateurs autorisés pour la gestion et la sécurité des comptes. Une consultation de page n’est pas assimilée à une nouvelle connexion. Les anciennes sessions encore conservées peuvent seulement fournir une indication partielle, signalée comme telle. Ce suivi n’ajoute pas de profilage public, de suivi publicitaire ni de mesure d’audience.</p>
    </section>
  </>;
}

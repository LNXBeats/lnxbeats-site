import type { Metadata } from "next";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { approvedPrivacyNotice } from "@/data/legal";
import { resolveAnalyticsConfiguration } from "@/lib/analytics/policy";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Politique de confidentialité de LNX Beats et LNX STUDIO.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  return <>
    <LegalCandidateDocument document={approvedPrivacyNotice} introduction="Informations sur les données traitées, leurs finalités, leurs destinataires, leurs durées de conservation et vos droits." />
    {resolveAnalyticsConfiguration(process.env) ? <section className="container" lang="fr" translate="no">
      <h2>Mesure d’audience facultative — Google Analytics</h2>
      <p>Avec votre accord préalable, LNX Beats utilise Google Analytics pour mesurer la fréquentation de ses pages publiques. Le script Analytics n’est pas chargé avant votre choix. Refuser n’empêche ni la consultation, ni l’inscription, ni l’achat. Ce choix est indépendant des alertes par e-mail et des préférences publicitaires.</p>
      <p>Après accord, Google reçoit des données de consultation limitées aux pages publiques autorisées ainsi que des informations techniques du navigateur et des identifiants de mesure. Les adresses transmises sont débarrassées des paramètres et fragments ; le titre de la page et l’adresse de provenance ne sont pas transmis par notre configuration. Aucun nom, e-mail, identifiant de compte, contenu de formulaire, commande ou paiement n’est envoyé par cette intégration. Elle est exclue des espaces Compte et Admin, de l’authentification, des paniers, des paiements et des autres parcours privés. Les fonctions publicitaires et Google Signals ne sont pas activées.</p>
      <p>Votre choix est mémorisé sur cet appareil pendant 180 jours au maximum. Les cookies de mesure sont également limités à cette durée, sans prolongation automatique à chaque visite. Vous pouvez modifier votre choix et retirer votre accord depuis « Mesure d’audience » sur les pages publiques du site ; ce retrait arrête la collecte ultérieure et supprime les cookies Analytics concernés sur cet appareil.</p>
      <p>Le destinataire est Google, prestataire international susceptible de traiter des données hors de l’Espace économique européen. Consultez <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer" target="_blank">l’utilisation des données par Google</a> et <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">sa politique de confidentialité</a>. Les coordonnées et droits décrits dans la présente politique restent applicables.</p>
    </section> : null}
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

import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Politique de confidentialité", robots: { index: false, follow: true }, alternates: { canonical: "/confidentialite" } };

export default function PrivacyPage() {
  return (
    <LegalPlaceholder
      title="Confidentialité"
      description="Le formulaire Commander reste local et ne transmet pas son contenu. En revanche, les parcours membres traitent déjà des données nécessaires à l’inscription, à la sécurité et aux sessions : cette réalité doit figurer dans la politique définitive."
      sections={[
        {
          title: "Traitements déjà identifiés",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: "Adresse email, nom d’affichage facultatif, rôle, statut et date de vérification du compte." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Identifiants techniques, mot de passe haché, sessions, vérifications et compteurs de limitation d’usage." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Messages de vérification et de récupération préparés par un transport local de QA ; aucun fournisseur email de production n’est configuré." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Le brief Commander et les fichiers sélectionnés restent sur l’appareil dans cette version." },
          ],
        },
        {
          title: "Informations à compléter avant publication",
          items: [
            { status: "À FOURNIR", text: "Identité et coordonnées du responsable de traitement." },
            { status: "À VALIDER", text: "Finalités, bases légales et durées de conservation pour chaque catégorie de donnée." },
            { status: "À VALIDER", text: "Procédure d’accès, rectification, effacement, opposition, limitation et portabilité." },
            { status: "À FOURNIR", text: "Coordonnées du contact confidentialité et, si nécessaire, du délégué à la protection des données." },
            { status: "À FOURNIR", text: "Hébergeur, fournisseur email futur et liste des sous-traitants de production." },
            { status: "À VALIDER", text: "Politique des cookies de session, sécurité, consentement et préférences de notifications." },
            { status: "À VALIDER", text: "Règles spécifiques aux futurs briefs, commandes, paiements, livraisons et pièces jointes." },
          ],
        },
      ]}
    />
  );
}

import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Politique de confidentialité", robots: { index: false, follow: true }, alternates: { canonical: "/confidentialite" } };

export default function PrivacyPage() {
  return (
    <LegalPlaceholder
      title="Confidentialité"
      description="Les comptes vérifiés peuvent désormais enregistrer un brief, une demande et des photos de référence privées. Cette page décrit ce traitement réel sans prétendre remplacer la politique juridiquement validée qui reste nécessaire avant production."
      sections={[
        {
          title: "Traitements déjà identifiés",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: "Adresse email, nom d’affichage facultatif, rôle, statut et date de vérification du compte." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Identifiants techniques, mot de passe haché, sessions, vérifications et compteurs de limitation d’usage." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Messages de vérification et de récupération préparés par un transport local de QA ; aucun fournisseur email de production n’est configuré." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Brouillons, briefs, choix musicaux, usages, prix calculés, statuts et événements utiles au client sont conservés en PostgreSQL." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Les photos acceptées sont limitées, contrôlées, réencodées sans métadonnées et stockées hors répertoire public dans un stockage local privé de développement/QA." },
            { status: "DÉJÀ IDENTIFIÉ", text: "Les fichiers privés sont servis après contrôle de session et de propriété ; leur contenu binaire n’est pas enregistré dans PostgreSQL." },
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
            { status: "À VALIDER", text: "Bases légales et durées de conservation des briefs, commandes, événements et photos, ainsi que la purge des brouillons abandonnés." },
            { status: "À VALIDER", text: "Règles futures des paiements, factures, livraisons WAV privées et notifications ; aucun de ces traitements n’est actif dans cette version." },
          ],
        },
      ]}
    />
  );
}

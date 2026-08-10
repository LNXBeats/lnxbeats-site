import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Mentions légales", robots: { index: false, follow: true }, alternates: { canonical: "/mentions-legales" } };

export default function LegalNoticePage() {
  return (
    <LegalPlaceholder
      title="Mentions légales"
      description="Cette page n’est pas une version juridique définitive. Elle prépare les champs nécessaires sans inventer l’identité professionnelle, les immatriculations ou les coordonnées de l’éditeur et de l’hébergeur."
      sections={[
        {
          title: "Éditeur et publication",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: "Nom artistique et site : LNX Beats." },
            { status: "À FOURNIR", text: "Identité ou dénomination professionnelle de l’éditeur." },
            { status: "À FOURNIR", text: "Forme ou statut juridique de l’activité." },
            { status: "À FOURNIR", text: "SIREN, SIRET et, si applicable, numéro de TVA intracommunautaire." },
            { status: "À FOURNIR", text: "Adresse professionnelle publiable." },
            { status: "À FOURNIR", text: "Identité du directeur ou de la directrice de publication." },
            { status: "À VALIDER", text: "Adresse email professionnelle de contact à publier." },
          ],
        },
        {
          title: "Hébergement et responsabilité",
          items: [
            { status: "À FOURNIR", text: "Dénomination légale, adresse et coordonnées de l’hébergeur de production." },
            { status: "À VALIDER", text: "Périmètre de responsabilité éditoriale et conditions d’utilisation du contenu." },
            { status: "À VALIDER", text: "Mentions relatives à la propriété intellectuelle des textes, musiques, images et marques." },
          ],
        },
      ]}
    />
  );
}

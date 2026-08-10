import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";
import { professionalInformation } from "@/data/professional";

export const metadata: Metadata = { title: "Mentions légales", robots: { index: false, follow: true }, alternates: { canonical: "/mentions-legales" } };

export default function LegalNoticePage() {
  return (
    <LegalPlaceholder
      title="Mentions légales"
      description="Les éléments professionnels confirmés sont publiés ci-dessous. Cette page reste préparatoire tant que l’adresse publiable, l’hébergeur, la direction de publication et la validation juridique finale ne sont pas réunis."
      sections={[
        {
          title: "Éditeur et publication",
          items: [
            { status: "DÉJÀ IDENTIFIÉ", text: `Éditeur : ${professionalInformation.name}, sous le nom artistique ${professionalInformation.artisticName}.` },
            { status: "DÉJÀ IDENTIFIÉ", text: `Statut : ${professionalInformation.legalForm}. Activité déclarée : ${professionalInformation.activity}.` },
            { status: "DÉJÀ IDENTIFIÉ", text: `SIREN : ${professionalInformation.siren}. SIRET : ${professionalInformation.siret}.` },
            { status: "À VALIDER", text: `Numéro de TVA communiqué : ${professionalInformation.vatNumberCommunicated}. Son régime et la mention fiscale applicable aux factures doivent être confirmés avant activation du paiement.` },
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
            { status: "À VALIDER", text: "Validation juridique et fiscale finale obligatoire avant activation d’un paiement ou émission d’une facture." },
          ],
        },
      ]}
    />
  );
}

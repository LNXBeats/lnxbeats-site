import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Politique de confidentialité", robots: { index: false, follow: true }, alternates: { canonical: "/confidentialite" } };

export default function PrivacyPage() {
  return <LegalPlaceholder title="Confidentialité" description="Cette version ne transmet ni ne conserve les données saisies dans le formulaire visuel de projet." />;
}

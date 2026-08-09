import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Politique de confidentialité", robots: { index: false, follow: true }, alternates: { canonical: "/confidentialite" } };

export default function PrivacyPage() {
  return <LegalPlaceholder title="Confidentialité" description="Cette V0.1 ne transmet ni ne conserve les données saisies dans le formulaire visuel de projet." />;
}

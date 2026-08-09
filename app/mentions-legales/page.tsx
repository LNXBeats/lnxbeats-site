import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal-placeholder";

export const metadata: Metadata = { title: "Mentions légales", robots: { index: false, follow: true }, alternates: { canonical: "/mentions-legales" } };

export default function LegalNoticePage() {
  return <LegalPlaceholder title="Mentions légales" description="Les informations d’éditeur, d’hébergeur et de responsabilité doivent être vérifiées avant publication définitive." />;
}

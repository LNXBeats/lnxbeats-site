import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { Container } from "@/components/container";
import { legalCandidateHistory } from "@/data/legal";
import { SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION, SHOP_LEGAL_QA_TERMS_VERSION } from "@/lib/shop/legal";

export const metadata: Metadata = { title: "Document juridique archivé", robots: { index: false, follow: false } };

export default async function ArchivedLegalDocumentPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const document = legalCandidateHistory.find((entry) => entry.version === version);
  if (document) return <LegalCandidateDocument document={document} introduction="Version immuable référencée par un snapshot contractuel. Son statut affiché détermine si elle peut être utilisée hors QA." />;
  if (version !== SHOP_LEGAL_QA_TERMS_VERSION && version !== SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION) notFound();
  return <section className="legal-index"><Container><p className="eyebrow">Archive technique QA</p><h1>{version}</h1><p>Cette référence correspond à une empreinte technique de tests locaux, sans contenu juridique approuvé.</p><p className="legal-document__warning">VERSION QA UNIQUEMENT — NON ACTIVE — SANS VALEUR CONTRACTUELLE EN PRODUCTION.</p></Container></section>;
}

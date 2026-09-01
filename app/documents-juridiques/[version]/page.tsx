import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalCandidateDocument } from "@/components/legal-candidate-document";
import { publicLegalDocuments } from "@/data/legal";

export const metadata: Metadata = { title: "Document juridique archivé", robots: { index: false, follow: false } };

export default async function ArchivedLegalDocumentPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const document = publicLegalDocuments.find((entry) => entry.version === version);
  if (!document) notFound();
  return <LegalCandidateDocument document={document} introduction="Version immuable du document juridique référencé." />;
}

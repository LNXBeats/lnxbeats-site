import type { LegalCandidate } from "@/data/legal";

export const PUBLIC_LEGAL_MARKER_PATTERN = new RegExp([
  "LEGAL_DECISION_REQUIRED",
  "ACCOUNTING_DECISION_REQUIRED",
  "LOGISTICS_DECISION_REQUIRED",
  "SOURCE_RECHECK_REQUIRED",
  "AWAITING_LEGAL_REVIEW",
  "QA_ONLY",
  "VERSION\\s+CANDIDATE",
  "REVUE\\s+HUMAINE\\s+OBLIGATOIRE",
  "BEFORE_PUBLICATION",
  "HUMAN_APPROVAL",
  "PROCESSOR_TRANSFER_MECHANISMS",
  "EARLY_PERFORMANCE_WITHDRAWAL_WORDING",
  "SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING",
  "SHOP_CONTRACT_FORMATION_TIME",
].join("|"), "i");

export function publicLegalDocument(document: LegalCandidate) {
  const content = Object.freeze({
    title: document.title,
    sections: Object.freeze(document.sections.map((section) => Object.freeze({
      title: section.title,
      paragraphs: Object.freeze([...section.paragraphs]),
    }))),
  });
  if (PUBLIC_LEGAL_MARKER_PATTERN.test(JSON.stringify(content))) {
    throw new Error("A public legal document contains an internal review marker.");
  }
  return content;
}

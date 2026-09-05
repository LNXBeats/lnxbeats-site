const creditNoteReasonLabels: Readonly<Record<string, string>> = Object.freeze({
  WITHDRAWAL: "Rétractation",
  NON_CONFORMITY: "Produit non conforme",
  SELLER_ERROR: "Erreur vendeur",
  DAMAGED_PRODUCT: "Produit endommagé",
  OTHER_REVIEWED: "Remboursement après traitement SAV",
});

export function creditNoteReasonLabel(value: string) {
  return creditNoteReasonLabels[value] ?? "Motif examiné";
}

export type BillingDocumentRenderMode = "FINAL" | "TEST";

export function billingDocumentRenderMode(paymentMode: string | null | undefined): BillingDocumentRenderMode {
  return paymentMode === "LIVE" ? "FINAL" : "TEST";
}

export function billingDocumentPresentation(kind: "INVOICE" | "CREDIT_NOTE", paymentMode: string | null | undefined) {
  const renderMode = billingDocumentRenderMode(paymentMode);
  const noun = kind === "INVOICE" ? "Facture" : "Avoir";
  return Object.freeze({
    renderMode,
    label: `${noun} · ${renderMode === "FINAL" ? "document comptable" : "document de test"}`,
    warning: renderMode === "FINAL"
      ? null
      : "DOCUMENT DE TEST — SANS VALEUR COMPTABLE.",
  });
}

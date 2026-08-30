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

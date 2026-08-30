const requestStatusLabels: Readonly<Record<string, string>> = Object.freeze({
  REQUESTED: "Demande enregistrée",
  UNDER_REVIEW: "En cours d’examen",
  APPROVED: "Acceptée",
  REJECTED: "Refusée",
  AWAITING_RETURN: "Retour attendu",
  RETURN_RECEIVED: "Retour reçu",
  INSPECTED: "Inspection terminée",
  REFUND_PENDING: "Remboursement en cours",
  REFUNDED: "Remboursée",
  CLOSED: "Clôturée",
  CANCELLED: "Annulée",
});

const requestTypeLabels: Readonly<Record<string, string>> = Object.freeze({
  WITHDRAWAL: "Rétractation",
  DEFECTIVE: "Produit défectueux",
  NON_CONFORMING: "Produit non conforme",
  DAMAGED: "Produit endommagé",
  LOGISTICS_INCIDENT: "Incident logistique",
  OTHER: "Autre motif",
});

const refundStatusLabels: Readonly<Record<string, string>> = Object.freeze({
  NOT_REQUESTED: "Non demandé",
  PENDING: "En attente",
  SUCCEEDED: "Confirmé",
  FAILED: "Échec",
  REQUIRES_REVIEW: "Revue requise",
});

const returnCostLabels: Readonly<Record<string, string>> = Object.freeze({
  UNDECIDED: "À décider",
  CUSTOMER: "Client",
  MERCHANT: "Vendeur",
  MANUAL_REVIEW: "Décision manuelle",
});

const auditActionLabels: Readonly<Record<string, string>> = Object.freeze({
  REQUEST_CREATED: "Demande créée",
  REVIEW_STARTED: "Revue démarrée",
  REQUEST_APPROVED: "Demande acceptée",
  REQUEST_REJECTED: "Demande refusée",
  REQUEST_CANCELLED: "Demande annulée",
  RETURN_RECEIVED: "Retour reçu",
  INSPECTION_RECORDED: "Inspection enregistrée",
  REFUND_REQUESTED: "Remboursement demandé",
  REFUND_CONFIRMED: "Remboursement confirmé",
  REFUND_FAILED: "Échec du remboursement",
  REFUND_REQUIRES_REVIEW: "Remboursement à vérifier",
  RESTOCK_COMPLETED: "Remise en stock enregistrée",
  REQUEST_CLOSED: "Dossier clôturé",
});

export function shopReturnStatusLabel(value: string) {
  return requestStatusLabels[value] ?? "État à vérifier";
}

export function shopReturnTypeLabel(value: string) {
  return requestTypeLabels[value] ?? "Motif à vérifier";
}

export function shopReturnRefundStatusLabel(value: string) {
  return refundStatusLabels[value] ?? "État à vérifier";
}

export function shopReturnCostDecisionLabel(value: string) {
  return returnCostLabels[value] ?? "Décision à vérifier";
}

export function shopReturnAuditActionLabel(value: string) {
  return auditActionLabels[value] ?? "Événement audité";
}

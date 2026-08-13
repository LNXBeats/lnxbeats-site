export const orderStatusPresentation = {
  DRAFT: { label: "Brouillon", next: "Compléter ou finaliser le brief." },
  AWAITING_PAYMENT: { label: "En attente de paiement", next: "Le paiement n’est pas encore disponible dans cette version." },
  PAYMENT_CONFIRMED: { label: "Paiement confirmé", next: "L’histoire va être transmise à LNX Beats." },
  RECEIVED: { label: "Histoire reçue", next: "LNX Beats va étudier le brief." },
  SUBMITTED: { label: "Histoire reçue", next: "LNX Beats va étudier le brief." },
  REVIEWING: { label: "En cours d’étude", next: "La faisabilité et les conditions sont en cours d’examen." },
  ACCEPTED: { label: "Commande acceptée", next: "La création pourra commencer selon les conditions convenues." },
  IN_PROGRESS: { label: "Création en cours", next: "L’écriture et la production avancent." },
  FIRST_VERSION_READY: { label: "Première version prête", next: "La première version attend votre retour." },
  REVISION_REQUESTED: { label: "Modification demandée", next: "Le retour conforme au brief initial est pris en compte." },
  FINALIZING: { label: "Finalisation", next: "La version finale est en préparation." },
  DELIVERED: { label: "Livrée", next: "La livraison restera disponible six mois à compter de sa mise à disposition." },
  REFUSED: { label: "Refusée", next: "Un remboursement intégral devra être déclenché si un paiement a été confirmé." },
  CANCELLED: { label: "Annulée", next: "Commande annulée. Aucun traitement supplémentaire n’est en cours." },
  REFUND_PENDING: { label: "Remboursement en cours", next: "Le remboursement futur est en cours de traitement." },
  REFUNDED: { label: "Remboursée", next: "Le remboursement futur a été confirmé." },
} as const;

export type KnownOrderStatus = keyof typeof orderStatusPresentation;

export const completedOrderStatuses = new Set<KnownOrderStatus>(["DELIVERED", "REFUSED", "CANCELLED", "REFUNDED"]);

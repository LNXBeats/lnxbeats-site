import type { KnownOrderStatus } from "@/lib/orders/status";

export type AdminOrderTransition = {
  to: KnownOrderStatus;
  label: string;
  eventNote: string;
  visibility: "CLIENT" | "INTERNAL";
  sensitive?: boolean;
};

const transitions = {
  DRAFT: [],
  AWAITING_PAYMENT: [
    { to: "RECEIVED", label: "Prendre en charge", eventNote: "L’histoire a été prise en charge par LNX Beats.", visibility: "CLIENT" },
    { to: "CANCELLED", label: "Annuler la demande", eventNote: "La demande a été annulée avant le début de la création.", visibility: "CLIENT", sensitive: true },
  ],
  PAYMENT_CONFIRMED: [
    { to: "RECEIVED", label: "Confirmer la réception", eventNote: "L’histoire a été reçue par LNX Beats.", visibility: "CLIENT" },
  ],
  RECEIVED: [
    { to: "REVIEWING", label: "Examiner le brief", eventNote: "L’étude du brief a commencé.", visibility: "CLIENT" },
    { to: "REFUSED", label: "Refuser la demande", eventNote: "LNX Beats ne pourra pas donner suite à cette demande.", visibility: "CLIENT", sensitive: true },
  ],
  SUBMITTED: [
    { to: "REVIEWING", label: "Examiner le brief", eventNote: "L’étude du brief a commencé.", visibility: "CLIENT" },
    { to: "REFUSED", label: "Refuser la demande", eventNote: "LNX Beats ne pourra pas donner suite à cette demande.", visibility: "CLIENT", sensitive: true },
  ],
  REVIEWING: [
    { to: "ACCEPTED", label: "Accepter la création", eventNote: "La demande a été acceptée.", visibility: "CLIENT" },
    { to: "REFUSED", label: "Refuser la demande", eventNote: "LNX Beats ne pourra pas donner suite à cette demande.", visibility: "CLIENT", sensitive: true },
  ],
  ACCEPTED: [
    { to: "IN_PROGRESS", label: "Passer en création", eventNote: "La création musicale a commencé.", visibility: "CLIENT" },
    { to: "CANCELLED", label: "Annuler la création", eventNote: "La création a été annulée.", visibility: "CLIENT", sensitive: true },
  ],
  IN_PROGRESS: [
    { to: "FIRST_VERSION_READY", label: "Première version prête", eventNote: "Une première version est prête pour le retour client.", visibility: "CLIENT" },
    { to: "CANCELLED", label: "Annuler la création", eventNote: "La création a été annulée.", visibility: "CLIENT", sensitive: true },
  ],
  FIRST_VERSION_READY: [
    { to: "REVISION_REQUESTED", label: "Enregistrer un retour client", eventNote: "Un retour sur la première version a été pris en compte.", visibility: "CLIENT" },
    { to: "FINALIZING", label: "Passer en finalisation", eventNote: "La version finale est en préparation.", visibility: "CLIENT" },
  ],
  REVISION_REQUESTED: [
    { to: "IN_PROGRESS", label: "Reprendre la création", eventNote: "Le retour client est en cours d’intégration.", visibility: "CLIENT" },
  ],
  FINALIZING: [
    { to: "DELIVERED", label: "Marquer comme livrée", eventNote: "La création a été marquée comme livrée. Aucun fichier n’est publié automatiquement.", visibility: "CLIENT", sensitive: true },
  ],
  DELIVERED: [],
  REFUSED: [],
  CANCELLED: [],
  REFUND_PENDING: [],
  REFUNDED: [],
} as const satisfies Record<KnownOrderStatus, readonly AdminOrderTransition[]>;

export function getAllowedOrderTransitions(status: KnownOrderStatus): readonly AdminOrderTransition[] {
  return transitions[status];
}

export function getAdminOrderTransition(currentStatus: KnownOrderStatus, requestedStatus: string) {
  return getAllowedOrderTransitions(currentStatus).find(({ to }) => to === requestedStatus) ?? null;
}

export function getOrderTransitionTimestamps(targetStatus: KnownOrderStatus, now: Date) {
  if (targetStatus === "IN_PROGRESS") return { serviceStartedAt: now };
  if (targetStatus === "DELIVERED") return { deliveredAt: now };
  if (targetStatus === "CANCELLED") return { cancelledAt: now };
  return {};
}

export function normalizeAdminNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note.length > 0 && note.length <= 1_000 ? note : null;
}

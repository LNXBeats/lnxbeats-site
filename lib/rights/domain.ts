import { createHash } from "node:crypto";

import { personalUseTerms, rightsOffers, type RightsOfferType } from "@/data/rights-offer";

export const terminalRightsStatuses = new Set(["REJECTED", "CANCELLED"] as const);

export const activeRightsStatuses = [
  "DRAFT",
  "SUBMITTED",
  "INFORMATION_REQUIRED",
  "UNDER_REVIEW",
  "PREAUTHORIZATION_GENERATED",
  "CONTRACT_PREPARATION",
  "CONTRACT_READY",
  "CLIENT_ACCEPTED",
  "ADMIN_VALIDATED",
  "READY_FOR_PAYMENT",
  "ACTIVE",
] as const;

export const rightsStatusPresentation = {
  DRAFT: { label: "Brouillon", action: "Complétez votre demande." },
  SUBMITTED: { label: "Demande envoyée", action: "LNX Beats va examiner votre dossier." },
  INFORMATION_REQUIRED: { label: "Informations complémentaires demandées", action: "Répondez à la demande de précision." },
  UNDER_REVIEW: { label: "En étude", action: "Aucune action requise pour le moment." },
  PREAUTHORIZATION_GENERATED: { label: "Projet de préautorisation disponible", action: "Consultez le document non actif." },
  CONTRACT_PREPARATION: { label: "Contrat en préparation", action: "Aucune action requise pour le moment." },
  CONTRACT_READY: { label: "Contrat prêt à lire", action: "Vérifiez le document avant toute acceptation." },
  CLIENT_ACCEPTED: { label: "Accepté par le client", action: "Validation LNX Beats en attente." },
  ADMIN_VALIDATED: { label: "Validé par LNX Beats", action: "Le paiement reste fermé." },
  READY_FOR_PAYMENT: { label: "Prêt pour paiement futur", action: "Le paiement sera ouvert après validation juridique et technique." },
  REJECTED: { label: "Demande non retenue", action: "Consultez le motif de la décision." },
  CANCELLED: { label: "Demande annulée", action: "Aucune action requise." },
  ACTIVE: { label: "Actif", action: "Consultez votre document contractuel." },
} as const;

export const rightsEventPresentation = {
  REQUEST_CREATED: "Demande créée",
  CONTACT_CONFIRMED: "Coordonnées confirmées",
  REQUEST_SUBMITTED: "Demande envoyée",
  INFORMATION_REQUESTED: "Informations demandées",
  INFORMATION_PROVIDED: "Informations fournies",
  REVIEW_STARTED: "Étude ouverte",
  PREAUTHORIZATION_GENERATED: "Préautorisation générée",
  CONTRACT_PARAMETERS_UPDATED: "Paramètres contractuels mis à jour",
  DOCUMENT_GENERATED: "Document généré",
  DOCUMENT_SUPERSEDED: "Nouvelle version générée",
  DOCUMENT_VIEWED: "Document consulté",
  CLIENT_ACCEPTED: "Acceptation client enregistrée",
  ADMIN_VALIDATED: "Validation Admin enregistrée",
  READY_FOR_PAYMENT: "Prêt pour une étape future",
  REQUEST_REJECTED: "Demande non retenue",
  REQUEST_CANCELLED: "Demande annulée",
} as const;

export const contractPartyPresentation = {
  INDIVIDUAL: "Particulier",
  SOLE_PROPRIETOR: "Entrepreneur individuel",
  COMPANY: "Société",
  ASSOCIATION_OR_OTHER: "Association / autre personne morale",
} as const;

export const contractTemplateStatusPresentation = {
  DRAFT: "Projet",
  AWAITING_LEGAL_REVIEW: "En attente de revue juridique",
  APPROVED: "Approuvé après revue",
  RETIRED: "Retiré",
} as const;

export const rightsAllowedTransitions = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["INFORMATION_REQUIRED", "UNDER_REVIEW", "REJECTED", "CANCELLED"],
  INFORMATION_REQUIRED: ["SUBMITTED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["INFORMATION_REQUIRED", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "REJECTED"],
  PREAUTHORIZATION_GENERATED: ["INFORMATION_REQUIRED", "CONTRACT_PREPARATION", "REJECTED"],
  CONTRACT_PREPARATION: ["CONTRACT_READY", "INFORMATION_REQUIRED", "REJECTED"],
  CONTRACT_READY: ["CLIENT_ACCEPTED", "CONTRACT_PREPARATION", "REJECTED"],
  CLIENT_ACCEPTED: ["ADMIN_VALIDATED", "CONTRACT_PREPARATION", "REJECTED"],
  ADMIN_VALIDATED: ["READY_FOR_PAYMENT", "CONTRACT_PREPARATION"],
  READY_FOR_PAYMENT: [],
  REJECTED: [],
  CANCELLED: [],
  ACTIVE: [],
} as const;

export type RightsStatus = keyof typeof rightsAllowedTransitions;

export function rightsPriceSnapshot(type: RightsOfferType) {
  return { ...rightsOffers[type] };
}

export function personalUseTermsSnapshot() {
  return {
    version: personalUseTerms.version,
    text: personalUseTerms.text,
    hashSha256: createHash("sha256").update(personalUseTerms.text, "utf8").digest("hex"),
  };
}

export function canCreateRightsRequest(input: {
  orderStatus: string;
  hasPublishedDelivery: boolean;
  existingStatuses: readonly string[];
}) {
  return input.orderStatus === "DELIVERED"
    && input.hasPublishedDelivery
    && !input.existingStatuses.some((status) => (activeRightsStatuses as readonly string[]).includes(status));
}

export function canTransitionRightsRequest(from: RightsStatus, to: RightsStatus) {
  return (rightsAllowedTransitions[from] as readonly string[]).includes(to);
}

export function assertRightsSplit(clientSharePercent: number, lnxSharePercent: number) {
  if (!Number.isInteger(clientSharePercent) || !Number.isInteger(lnxSharePercent)) return false;
  return clientSharePercent >= 0
    && clientSharePercent <= 100
    && lnxSharePercent >= 0
    && lnxSharePercent <= 100
    && clientSharePercent + lnxSharePercent === 100;
}

export function retentionUntilForConcludedContract(concludedAt: Date) {
  const result = new Date(concludedAt);
  result.setUTCFullYear(result.getUTCFullYear() + 10);
  return result;
}

export function rightsRequestPrefix(type: RightsOfferType) {
  return type === "PUBLICATION_LICENSE" ? "LNX-LIC" : "LNX-PART";
}

export function formatRightsNumber(type: RightsOfferType, sequence: bigint | number, date = new Date()) {
  const numeric = typeof sequence === "bigint" ? sequence : BigInt(sequence);
  if (numeric <= 0n) throw new RangeError("Rights sequence must be positive.");
  return `${rightsRequestPrefix(type)}-${date.getUTCFullYear()}-${numeric.toString().padStart(6, "0")}`;
}

export function isLegalTemplateUsable(status: string, approvedAt: Date | null, approvedByAdminId: string | null) {
  return status === "APPROVED" && approvedAt !== null && approvedByAdminId !== null;
}

export function rightsPaymentEnabled() {
  return false as const;
}

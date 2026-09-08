import type { RightsRequestStatus } from "@/generated/prisma/client";

export const rightsAdminViews = [
  "attention",
  "active",
  "waiting-client",
  "payment-closed",
  "completed",
  "archives",
  "all",
] as const;

export type RightsAdminView = (typeof rightsAdminViews)[number];

export const rightsAdminViewLabels: Record<RightsAdminView, string> = {
  attention: "À examiner",
  active: "En cours",
  "waiting-client": "En attente client",
  "payment-closed": "Prêtes / paiement fermé",
  completed: "Terminées",
  archives: "Archives",
  all: "Toutes",
};

const statusesByView = {
  attention: new Set<RightsRequestStatus>(["SUBMITTED", "CLIENT_ACCEPTED"]),
  active: new Set<RightsRequestStatus>([
    "UNDER_REVIEW",
    "PREAUTHORIZATION_GENERATED",
    "CONTRACT_PREPARATION",
  ]),
  "waiting-client": new Set<RightsRequestStatus>([
    "DRAFT",
    "INFORMATION_REQUIRED",
    "CONTRACT_READY",
  ]),
  "payment-closed": new Set<RightsRequestStatus>([
    "ADMIN_VALIDATED",
    "READY_FOR_PAYMENT",
  ]),
  completed: new Set<RightsRequestStatus>(["REJECTED", "CANCELLED"]),
} as const;

export function parseRightsAdminView(value: string | undefined): RightsAdminView {
  return (rightsAdminViews as readonly string[]).includes(value ?? "")
    ? value as RightsAdminView
    : "attention";
}

export function rightsRequestMatchesAdminView(input: {
  status: RightsRequestStatus;
  archived: boolean;
}, view: RightsAdminView) {
  if (view === "archives") return input.archived;
  if (input.archived) return false;
  if (view === "all") return true;
  return statusesByView[view].has(input.status);
}

export function countRightsAdminViews(
  requests: readonly { id: string; status: RightsRequestStatus }[],
  archivedIds: ReadonlySet<string>,
) {
  return Object.fromEntries(rightsAdminViews.map((view) => [
    view,
    requests.filter((request) => rightsRequestMatchesAdminView({
      status: request.status,
      archived: archivedIds.has(request.id),
    }, view)).length,
  ])) as Record<RightsAdminView, number>;
}

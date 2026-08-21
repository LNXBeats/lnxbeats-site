import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { rightsFailureDiagnostic } from "@/lib/rights/http";
import { RightsServiceError } from "@/lib/rights/service";
import type { RightsDocumentGenerationResult } from "@/lib/rights/workflow";

type DocumentKind = "CONTRACT" | "SACEM_PREPARATION";

export type AdminRightsDocumentGenerationDependencies = Readonly<{
  authenticateAdmin: () => Promise<OrderActor>;
  generate: (
    actor: OrderActor,
    requestNumber: string,
    kind: DocumentKind,
    expectedDocumentVersion: number,
  ) => Promise<RightsDocumentGenerationResult>;
  refresh: (requestNumber: string) => void;
  dispatchNotifications: () => void;
  redirect: (location: string) => never;
  logUnexpectedFailure: (diagnostic: ReturnType<typeof rightsFailureDiagnostic>) => void;
}>;

const requestNumberPattern = /^LNX-(LIC|PART)-\d{4}-\d{6}$/;

function detailPath(requestNumber: string, state: string) {
  return `/admin/droits/${encodeURIComponent(requestNumber)}?etat=${encodeURIComponent(state)}`;
}

const serviceErrorStates: Readonly<Record<string, string>> = {
  RIGHTS_TRANSITION_FORBIDDEN: "generation-etape-requise",
  RIGHTS_PARAMETERS_REQUIRED: "generation-parametres-requis",
  CONTACT_NOT_CONFIRMED: "generation-coordonnees-requises",
  CONTRACT_TEMPLATE_UNAVAILABLE: "generation-modele-indisponible",
  CONTRACT_TEMPLATE_INVALID: "generation-modele-invalide",
  CONTRACT_TEMPLATE_CHANGED: "generation-page-obsolete",
  CONTRACT_STORAGE_UNAVAILABLE: "generation-stockage-indisponible",
  CONTRACT_VERSION_CHANGED: "generation-page-obsolete",
  INVALID_DOCUMENT_VERSION: "generation-version-invalide",
};

export async function handleAdminRightsDocumentGeneration(
  formData: FormData,
  dependencies: AdminRightsDocumentGenerationDependencies,
): Promise<never> {
  const requestNumber = String(formData.get("requestNumber") ?? "");
  if (!requestNumberPattern.test(requestNumber)) dependencies.redirect("/admin/droits?etat=invalide");

  const kind: DocumentKind = formData.get("kind") === "SACEM_PREPARATION" ? "SACEM_PREPARATION" : "CONTRACT";
  const expectedDocumentVersion = Number(formData.get("expectedDocumentVersion"));
  if (!Number.isInteger(expectedDocumentVersion) || expectedDocumentVersion < 1) {
    dependencies.redirect(detailPath(requestNumber, "generation-version-invalide"));
  }

  let result: RightsDocumentGenerationResult;
  try {
    const actor = await dependencies.authenticateAdmin();
    result = await dependencies.generate(actor, requestNumber, kind, expectedDocumentVersion);
  } catch (error) {
    if (error instanceof RightsServiceError) {
      dependencies.redirect(detailPath(requestNumber, serviceErrorStates[error.code] ?? "generation-refusee"));
    }
    dependencies.logUnexpectedFailure(rightsFailureDiagnostic(error));
    dependencies.redirect(detailPath(requestNumber, "generation-indisponible"));
  }

  dependencies.refresh(requestNumber);
  if (result.documentStatus === "READY_FOR_CLIENT") dependencies.dispatchNotifications();
  dependencies.redirect(detailPath(requestNumber, kind === "CONTRACT"
    ? result.documentStatus === "DRAFT" ? "projet-draft-genere" : "contrat-genere"
    : "fiche-sacem-generee"));
}

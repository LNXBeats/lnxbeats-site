"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { OrderActor } from "@/lib/orders/domain";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { handleAdminRightsDocumentGeneration } from "@/lib/rights/admin-generation-entrypoint";
import {
  adminValidateRightsContract,
  approveContractTemplate,
  generateRightsDocument,
  rejectRightsRequest,
  requestRightsInformation,
  saveRightsGrant,
  saveSplitProposal,
  startRightsReview,
  updateAiContributionAssessment,
} from "@/lib/rights/workflow";

function path(requestNumber: string, state: string) {
  return `/admin/droits/${encodeURIComponent(requestNumber)}?etat=${encodeURIComponent(state)}`;
}

async function adminActor(): Promise<OrderActor> {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) throw new Error("Origine refusée.");
  const session = await requireAdmin();
  return { id: session.user.id, email: session.user.email, name: session.user.name, role: "ADMIN", status: "ACTIVE", emailVerified: true };
}

function requestNumber(formData: FormData) {
  const value = String(formData.get("requestNumber") ?? "");
  if (!/^LNX-(LIC|PART)-\d{4}-\d{6}$/.test(value)) redirect("/admin/droits?etat=invalide");
  return value;
}

function refresh(value: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/droits");
  revalidatePath(`/admin/droits/${value}`);
  revalidatePath("/compte");
  revalidatePath(`/compte/droits/${value}`);
}

function dispatchNotifications() {}

export async function startRightsReviewAction(formData: FormData) {
  const value = requestNumber(formData);
  try { await startRightsReview(await adminActor(), value); } catch { redirect(path(value, "action-refusee")); }
  refresh(value); redirect(path(value, "etude-ouverte"));
}

export async function requestRightsInformationAction(formData: FormData) {
  const value = requestNumber(formData);
  try { await requestRightsInformation(await adminActor(), value, formData.get("message"), formData.getAll("requestedFields")); } catch { redirect(path(value, "informations-invalides")); }
  refresh(value); dispatchNotifications(); redirect(path(value, "informations-demandees"));
}

export async function rejectRightsRequestAction(formData: FormData) {
  const value = requestNumber(formData);
  try { await rejectRightsRequest(await adminActor(), value, formData.get("reason")); } catch { redirect(path(value, "rejet-refuse")); }
  refresh(value); dispatchNotifications(); redirect(path(value, "demande-rejetee"));
}

export async function updateAiAssessmentAction(formData: FormData) {
  const value = requestNumber(formData);
  try { await updateAiContributionAssessment(await adminActor(), value, formData.get("assessment")); } catch { redirect(path(value, "evaluation-invalide")); }
  refresh(value); redirect(path(value, "evaluation-enregistree"));
}

export async function saveRightsGrantAction(formData: FormData) {
  const value = requestNumber(formData);
  try {
    await saveRightsGrant(await adminActor(), value, {
      kind: String(formData.get("kind") ?? "") as Parameters<typeof saveRightsGrant>[2]["kind"],
      authorized: formData.get("authorized") === "on",
      exclusive: formData.get("exclusive") === "on",
      destination: String(formData.get("destination") ?? ""),
      platforms: String(formData.get("platforms") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      territory: String(formData.get("territory") ?? ""),
      duration: String(formData.get("duration") ?? ""),
      monetization: formData.get("monetization") === "on",
      adaptation: formData.get("adaptation") === "on",
      advertising: formData.get("advertising") === "on",
      audiovisualSync: formData.get("audiovisualSync") === "on",
      contentId: formData.get("contentId") === "on",
      sublicense: formData.get("sublicense") === "on",
      credit: String(formData.get("credit") ?? ""),
      restrictions: String(formData.get("restrictions") ?? ""),
    });
  } catch { redirect(path(value, "parametre-invalide")); }
  refresh(value); redirect(path(value, "parametre-enregistre"));
}

export async function saveSplitProposalAction(formData: FormData) {
  const value = requestNumber(formData);
  try {
    await saveSplitProposal(await adminActor(), value, {
      clientSharePercent: Number(formData.get("clientSharePercent")),
      lnxSharePercent: Number(formData.get("lnxSharePercent")),
      nature: formData.get("nature"),
      comment: formData.get("comment"),
      contributionRationale: formData.get("contributionRationale"),
      proposedRoles: String(formData.get("proposedRoles") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    });
  } catch { redirect(path(value, "repartition-invalide")); }
  refresh(value); redirect(path(value, "repartition-enregistree"));
}

export async function generateRightsDocumentAction(formData: FormData) {
  return handleAdminRightsDocumentGeneration(formData, {
    authenticateAdmin: adminActor,
    generate: generateRightsDocument,
    refresh,
    dispatchNotifications,
    redirect,
    logUnexpectedFailure(diagnostic) {
      console.error("rights.admin.document_generation_failed", JSON.stringify(diagnostic));
    },
  });
}

export async function adminValidateRightsContractAction(formData: FormData) {
  const value = requestNumber(formData);
  try { await adminValidateRightsContract(await adminActor(), value, formData.get("typedFullName"), formData.get("accepted") === "on"); } catch { redirect(path(value, "validation-refusee")); }
  refresh(value); dispatchNotifications(); redirect(path(value, "validation-admin-enregistree"));
}

export async function approveContractTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) redirect("/admin/droits?etat=modele-invalide");
  try { await approveContractTemplate(await adminActor(), templateId, formData.get("legalReviewReference")); } catch { redirect("/admin/droits?etat=revue-juridique-requise"); }
  revalidatePath("/admin/droits"); redirect("/admin/droits?etat=modele-approuve");
}

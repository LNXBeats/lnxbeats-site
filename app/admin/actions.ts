"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { addInternalOrderNote, deleteEligibleAdminOrder, transitionOrderStatus } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { expireCheckoutAfterCancellation } from "@/lib/payments/service";
import {
  LIVE_REFUND_CONFIRMATION,
  LIVE_REFUND_RECONCILIATION_CONFIRMATION,
  parseRefundAmountToCents,
  reconcileRefundAttemptForAdmin,
  requestRefundForOrder,
} from "@/lib/payments/refund";

function adminOrderPath(orderNumber: string, state: string) {
  return `/admin/commandes/${encodeURIComponent(orderNumber)}?etat=${encodeURIComponent(state)}`;
}

async function authorizeAdminAction() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  const request = new Request(baseUrl, { method: "POST", headers: requestHeaders });
  if (!isSameOriginMutation(request, baseUrl)) throw new Error("Origine refusée.");
  return requireAdmin();
}

export async function transitionOrderAction(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const targetStatus = String(formData.get("targetStatus") ?? "");
  if (!/^LNX-\d{4}-\d{6}$/.test(orderNumber)) redirect("/admin/commandes?etat=invalide");
  const session = await authorizeAdminAction();
  try {
    await transitionOrderStatus(orderNumber, targetStatus, session.user.id);
  } catch {
    redirect(adminOrderPath(orderNumber, "transition-refusee"));
  }
  if (targetStatus === "CANCELLED") {
    try {
      await expireCheckoutAfterCancellation(orderNumber);
    } catch {
      revalidatePath("/admin");
      revalidatePath("/admin/commandes");
      revalidatePath(`/admin/commandes/${orderNumber}`);
      revalidatePath(`/compte/commandes/${orderNumber}`);
      redirect(adminOrderPath(orderNumber, "annulation-paiement-a-verifier"));
    }
  }
  revalidatePath("/admin");
  revalidatePath("/admin/commandes");
  revalidatePath(`/admin/commandes/${orderNumber}`);
  revalidatePath(`/compte/commandes/${orderNumber}`);
  redirect(adminOrderPath(orderNumber, "statut-mis-a-jour"));
}

export async function addInternalNoteAction(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  if (!/^LNX-\d{4}-\d{6}$/.test(orderNumber)) redirect("/admin/commandes?etat=invalide");
  const session = await authorizeAdminAction();
  try {
    await addInternalOrderNote(orderNumber, formData.get("note"), session.user.id);
  } catch {
    redirect(adminOrderPath(orderNumber, "note-invalide"));
  }
  revalidatePath(`/admin/commandes/${orderNumber}`);
  redirect(adminOrderPath(orderNumber, "note-ajoutee"));
}

export async function deleteOrderAction(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!/^LNX-\d{4}-\d{6}$/.test(orderNumber) || confirmation !== orderNumber) redirect("/admin/commandes?etat=suppression-invalide");
  await authorizeAdminAction();
  try {
    await deleteEligibleAdminOrder(orderNumber);
  } catch {
    redirect(adminOrderPath(orderNumber, "suppression-refusee"));
  }
  revalidatePath("/admin");
  revalidatePath("/admin/commandes");
  revalidatePath("/compte");
  redirect("/admin/commandes?etat=commande-supprimee");
}

function adminActor(session: Awaited<ReturnType<typeof requireAdmin>>) {
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    emailVerified: true as const,
  };
}

export async function requestPaymentRefundAction(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const kind = String(formData.get("refundKind") ?? "");
  const requestToken = String(formData.get("requestToken") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (
    !/^LNX-\d{4}-\d{6}$/.test(orderNumber)
    || (kind !== "FULL" && kind !== "PARTIAL")
    || !/^[0-9a-f-]{36}$/i.test(requestToken)
    || !["CONFIRM_FINANCIAL_REFUND", LIVE_REFUND_CONFIRMATION].includes(confirmation)
  ) redirect(adminOrderPath(orderNumber, "remboursement-refuse"));
  const session = await authorizeAdminAction();
  let amountCents: number | undefined;
  try {
    amountCents = kind === "PARTIAL" ? parseRefundAmountToCents(formData.get("amount")) : undefined;
    const result = await requestRefundForOrder(adminActor(session), {
      orderNumber,
      kind,
      amountCents,
      requestToken,
      liveConfirmation: confirmation,
    });
    revalidatePath(`/admin/commandes/${orderNumber}`);
    redirect(adminOrderPath(orderNumber, result.status === "SUCCEEDED" ? "remboursement-confirme" : "remboursement-en-cours"));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(adminOrderPath(orderNumber, "remboursement-a-verifier"));
  }
}

export async function reconcilePaymentRefundAction(formData: FormData) {
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const attemptId = String(formData.get("attemptId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (
    !/^LNX-\d{4}-\d{6}$/.test(orderNumber)
    || !/^[0-9a-f-]{36}$/i.test(attemptId)
    || !["CONFIRM_REFUND_RECONCILIATION", LIVE_REFUND_RECONCILIATION_CONFIRMATION].includes(confirmation)
  ) {
    redirect(adminOrderPath(orderNumber, "remboursement-refuse"));
  }
  const session = await authorizeAdminAction();
  try {
    const result = await reconcileRefundAttemptForAdmin(adminActor(session), attemptId, undefined, confirmation);
    revalidatePath(`/admin/commandes/${orderNumber}`);
    redirect(adminOrderPath(orderNumber, result.status === "SUCCEEDED" ? "remboursement-confirme" : "remboursement-en-cours"));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(adminOrderPath(orderNumber, "remboursement-a-verifier"));
  }
}

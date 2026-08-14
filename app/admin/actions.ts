"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { addInternalOrderNote, deleteEligibleAdminOrder, transitionOrderStatus } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { expireCheckoutAfterCancellation } from "@/lib/payments/service";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";

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
  if (targetStatus === "DELIVERED") {
    after(async () => {
      await dispatchPendingOrderNotifications().catch(() => undefined);
    });
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

"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { isAdminNotificationRetryConfirmed, isAdminNotificationSuppressionConfirmed } from "@/lib/notifications/admin-presentation";
import { retryNotificationManually, suppressNotificationRecipientManually } from "@/lib/notifications/service";

async function requireSameOriginAdmin() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    redirect("/admin/notifications?etat=origine-refusee");
  }
  return requireAdmin();
}

export async function retryNotificationAction(formData: FormData) {
  const id = String(formData.get("notificationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/admin/notifications?etat=invalide");
  if (!isAdminNotificationRetryConfirmed(formData.get("retryConfirmation"))) {
    redirect("/admin/notifications?etat=confirmation-requise");
  }
  const session = await requireSameOriginAdmin();
  try {
    await retryNotificationManually(id, session.user.id);
  } catch {
    redirect("/admin/notifications?etat=retry-refuse");
  }
  revalidatePath("/admin/notifications");
  redirect("/admin/notifications?etat=retry-planifie");
}

export async function suppressNotificationRecipientAction(formData: FormData) {
  const id = String(formData.get("notificationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/admin/notifications?etat=invalide");
  if (!isAdminNotificationSuppressionConfirmed(formData.get("suppressionConfirmation"))) {
    redirect("/admin/notifications?etat=confirmation-requise");
  }
  const session = await requireSameOriginAdmin();
  try {
    await suppressNotificationRecipientManually(id, session.user.id);
  } catch {
    redirect("/admin/notifications?etat=suppression-refusee");
  }
  revalidatePath("/admin/notifications");
  redirect("/admin/notifications?etat=suppression-ajoutee");
}

"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { retryNotificationManually } from "@/lib/notifications/service";

export async function retryNotificationAction(formData: FormData) {
  const id = String(formData.get("notificationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/admin/notifications?etat=invalide");
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) redirect("/admin/notifications?etat=origine-refusee");
  const session = await requireAdmin();
  try {
    await retryNotificationManually(id, session.user.id);
  } catch {
    redirect("/admin/notifications?etat=retry-refuse");
  }
  revalidatePath("/admin/notifications");
  redirect("/admin/notifications?etat=retry-planifie");
}

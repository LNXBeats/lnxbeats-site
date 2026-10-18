"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateCreationWork } from "@/lib/admin/creation-work";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";

export async function creationWorkAction(formData: FormData) {
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: await headers() }), baseUrl)) throw new Error("Origine refusée.");
  const session = await requireAdmin();
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "DEADLINE" && kind !== "HIDE" && kind !== "RESTORE") redirect("/admin?suivi=invalide#centre-creations");
  try {
    await updateCreationWork({
      orderNumber: String(formData.get("orderNumber") ?? ""), actorUserId: session.user.id,
      requestId: String(formData.get("requestId") ?? ""), expectedUpdatedAt: String(formData.get("updatedAt") ?? ""),
      expectedRevision: String(formData.get("revision") ?? ""), kind,
      deadline: String(formData.get("deadline") ?? ""), confirmedTest: formData.get("confirmedTest") === "yes",
    });
  } catch {
    redirect("/admin?suivi=refuse#centre-creations");
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/commandes/${String(formData.get("orderNumber"))}`);
  redirect("/admin?suivi=enregistre#centre-creations");
}

"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { executeAdminCleanupPlan, parseAdminCleanupTargets } from "@/lib/admin/cleanup";
import { ADMIN_CLEANUP_CONFIRMATION } from "@/lib/admin/cleanup-contract";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";

export async function executeAdminCleanupAction(formData: FormData) {
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  const request = new Request(baseUrl, { method: "POST", headers: await headers() });
  if (!isSameOriginMutation(request, baseUrl)) redirect("/admin/nettoyage?etat=origine-refusee");
  if (formData.get("confirmation") !== ADMIN_CLEANUP_CONFIRMATION) redirect("/admin/nettoyage?etat=confirmation-requise");
  const session = await requireAdmin();
  let result;
  try {
    const targets = parseAdminCleanupTargets(formData.getAll("targets").map(String));
    if (!targets.length) redirect("/admin/nettoyage?etat=selection-vide");
    result = await executeAdminCleanupPlan(targets, session.user.id);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/admin/nettoyage?etat=classification-changee");
  }
  revalidatePath("/admin");
  revalidatePath("/admin/commandes");
  revalidatePath("/admin/boutique/commandes");
  revalidatePath("/admin/droits");
  revalidatePath("/admin/nettoyage");
  const state = new URLSearchParams({
    etat: "plan-applique",
    supprimes: String(result.deleted), archives: String(result.archived), ignores: String(result.ignored),
  });
  redirect(`/admin/nettoyage?${state}`);
}

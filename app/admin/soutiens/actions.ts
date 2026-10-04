"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { refundSupportContribution, reconcileAdminSupportReference } from "@/lib/support/service";

export async function reconcileSupportAction(form: FormData) {
  await requireAdmin();
  const origin = process.env.AUTH_URL ?? process.env.SITE_URL;
  if (!origin || !isSameOriginMutation(new Request(origin, { method: "POST", headers: await headers() }), origin)) throw new Error("Origine refusée.");
  const id = String(form.get("contributionId") ?? "");
  let state = "traitement";
  try { await reconcileAdminSupportReference(id, form.get("operation") === "REFUND" ? "REFUND" : "CHECKOUT", String(form.get("reference") ?? "")); }
  catch { state = "non-confirme"; }
  revalidatePath("/admin/soutiens");
  redirect(`/admin/soutiens/${encodeURIComponent(id)}?etat=${state}`);
}

export async function refundSupportAction(form: FormData) {
  const session = await requireAdmin();
  const origin = process.env.AUTH_URL ?? process.env.SITE_URL;
  if (!origin || !isSameOriginMutation(new Request(origin, { method: "POST", headers: await headers() }), origin)) throw new Error("Origine refusée.");
  const contributionId = String(form.get("contributionId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contributionId)) redirect("/admin/soutiens");
  let state = "traitement";
  try { await refundSupportContribution({ contributionId, adminId: session.user.id, confirmation: String(form.get("confirmation") ?? "") }); }
  catch { state = "non-confirme"; }
  revalidatePath("/admin/soutiens"); revalidatePath(`/admin/soutiens/${contributionId}`);
  redirect(`/admin/soutiens/${contributionId}?etat=${state}`);
}

"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { resolveFinancialEventReview } from "@/lib/admin/financial-event-review";
import { financialEventDetailPath } from "@/lib/admin/financial-event-policy";
import { setFinancialReceiptSeen } from "@/lib/admin/financial-event-seen";

export async function markFinancialReceiptSeenAction(formData: FormData) {
  const session = await requireAdmin();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: await headers() }), baseUrl)) throw new Error("Origine refusée.");
  const seen = formData.get("seen") === "yes";
  if (!["yes", "no"].includes(String(formData.get("seen")))) throw Error("Choix invalide.");
  let state = seen ? "lu" : "a-lire";
  try { await setFinancialReceiptSeen({ eventId: String(formData.get("eventId") ?? ""), actorId: session.user.id,
    seen, expectedHash: String(formData.get("snapshotHash") ?? ""), expectedRevision: String(formData.get("revision") ?? ""), requestId: String(formData.get("requestId") ?? "") }); }
  catch { state = "lecture-non-enregistree"; }
  revalidatePath("/admin/evenements-financiers");
  redirect(`/admin/evenements-financiers?vue=${seen ? "lus" : "a-lire"}&etat=${state}`);
}

export async function resolveExpiredCheckoutAction(formData: FormData) {
  const session = await requireAdmin();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: await headers() }), baseUrl)) throw new Error("Origine refusée.");
  const id = String(formData.get("eventId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || formData.get("confirmation") !== "expired-unpaid") throw new Error("Confirmation refusée.");
  let state = "classe";
  try { await resolveFinancialEventReview(id, session.user.id); }
  catch { state = "revue-requise"; }
  for (const path of ["/admin", "/admin/commandes", "/admin/evenements-financiers", financialEventDetailPath(id)]) revalidatePath(path);
  redirect(`${financialEventDetailPath(id)}?etat=${state}`);
}

export async function reconcileSupportPaymentAction(formData: FormData) {
  const session = await requireAdmin();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: await headers() }), baseUrl)) throw new Error("Origine refusée.");
  const id = String(formData.get("eventId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || formData.get("confirmation") !== "support-reconciled") throw new Error("Confirmation refusée.");
  let state = "classe";
  try { await resolveFinancialEventReview(id, session.user.id, undefined, "SUPPORT_PAYMENT_RECONCILED"); }
  catch { state = "revue-requise"; }
  for (const path of ["/admin", "/admin/commandes", "/admin/evenements-financiers", financialEventDetailPath(id)]) revalidatePath(path);
  redirect(`${financialEventDetailPath(id)}?etat=${state}`);
}

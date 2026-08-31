"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { activatePhase5ECommercialRate, SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION } from "@/lib/shop/shipping-service";

export async function activateCommercialShippingRateAction(formData: FormData) {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) throw new Error("Origine refusée.");
  const session = await requireAdmin();
  const version = String(formData.get("version") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== SHOP_COMMERCIAL_RATE_ACTIVATION_CONFIRMATION) redirect("/admin/boutique/logistique?etat=confirmation-requise");
  try {
    await activatePhase5ECommercialRate(version, session.user.id, confirmation);
  } catch {
    redirect("/admin/boutique/logistique?etat=activation-refusee");
  }
  revalidatePath("/admin/boutique/logistique");
  redirect("/admin/boutique/logistique?etat=grille-activee");
}

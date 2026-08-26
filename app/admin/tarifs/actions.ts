"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { MUSIC_PRICING_ACTIVATION_CONFIRMATION } from "@/lib/pricing/domain";
import {
  createAndActivateMusicPricingVersion,
  MusicPricingServiceError,
} from "@/lib/pricing/service";

const PRICING_FORM_FIELDS = new Set([
  "expectedRevision",
  "currency",
  "basePrice",
  "coverPrice",
  "priorityPrice",
  "confirmation",
]);

function strictPricingFormData(formData: FormData) {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!PRICING_FORM_FIELDS.has(key) || key in result || typeof value !== "string") {
      throw new Error("Formulaire tarifaire invalide.");
    }
    result[key] = value;
  }
  return result;
}

async function requireSameOriginAdmin() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  const request = new Request(baseUrl, { method: "POST", headers: requestHeaders });
  if (!isSameOriginMutation(request, baseUrl)) {
    redirect("/admin/tarifs?etat=origine-refusee");
  }
  return requireAdmin();
}

export async function activateMusicPricingVersionAction(formData: FormData) {
  const session = await requireSameOriginAdmin();
  let input: Record<string, string>;
  try {
    input = strictPricingFormData(formData);
  } catch {
    redirect("/admin/tarifs?etat=activation-refusee");
  }
  if (input.confirmation !== MUSIC_PRICING_ACTIVATION_CONFIRMATION) {
    redirect("/admin/tarifs?etat=confirmation-requise");
  }

  try {
    await createAndActivateMusicPricingVersion({
      expectedRevision: input.expectedRevision,
      actorAdminId: session.user.id,
      pricing: {
        currency: input.currency,
        basePrice: input.basePrice,
        coverPrice: input.coverPrice,
        priorityPrice: input.priorityPrice,
      },
    });
  } catch (error) {
    if (error instanceof MusicPricingServiceError && error.code === "REVISION_CONFLICT") {
      redirect("/admin/tarifs?etat=conflit-recharger");
    }
    if (error instanceof MusicPricingServiceError && error.code === "UNCHANGED") {
      redirect("/admin/tarifs?etat=aucun-changement");
    }
    redirect("/admin/tarifs?etat=activation-refusee");
  }

  revalidatePath("/admin/tarifs");
  redirect("/admin/tarifs?etat=version-activee");
}

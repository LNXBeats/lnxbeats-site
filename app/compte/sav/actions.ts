"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  parseMemberShopReturnForm,
  parseShopReturnRequestNumber,
  SHOP_RETURN_CANCEL_CONFIRMATION,
} from "@/lib/shop/after-sales-domain";
import { cancelMemberShopReturn, createMemberShopReturn } from "@/lib/shop/after-sales-service";
import { addShopReturnEvidence } from "@/lib/shop/evidence-service";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  const session = await requireVerifiedUser("/compte");
  return {
    id: session.user.id,
    role: session.user.role,
    status: session.user.status,
    emailVerified: session.user.emailVerified,
  } as const;
}

export async function createShopReturnAction(formData: FormData) {
  const actor = await authorize();
  let orderNumber = "";
  try {
    const input = parseMemberShopReturnForm(formData);
    orderNumber = input.orderNumber;
    const created = await createMemberShopReturn(actor, input);
    revalidatePath("/compte");
    revalidatePath(`/compte/achats/${orderNumber}`);
    redirect(`/compte/sav/${encodeURIComponent(created.requestNumber)}?etat=demande-enregistree`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(orderNumber ? `/compte/achats/${encodeURIComponent(orderNumber)}/sav?etat=demande-refusee` : "/compte?etat=demande-sav-refusee");
  }
}

export async function cancelShopReturnAction(formData: FormData) {
  const actor = await authorize();
  let requestNumber = "";
  try {
    requestNumber = parseShopReturnRequestNumber(formData.get("requestNumber"));
    if (formData.get("confirmation") !== SHOP_RETURN_CANCEL_CONFIRMATION) throw new Error("Confirmation requise.");
    await cancelMemberShopReturn(actor, requestNumber);
    revalidatePath("/compte");
    revalidatePath(`/compte/sav/${requestNumber}`);
    redirect(`/compte/sav/${encodeURIComponent(requestNumber)}?etat=demande-annulee`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(requestNumber ? `/compte/sav/${encodeURIComponent(requestNumber)}?etat=operation-refusee` : "/compte");
  }
}

export async function addShopReturnEvidenceAction(formData: FormData) {
  const actor = await authorize();
  let requestNumber = "";
  try {
    requestNumber = parseShopReturnRequestNumber(formData.get("requestNumber"));
    const files = formData.getAll("evidence").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length < 1 || files.length > 5) throw new Error("Fichiers invalides.");
    await addShopReturnEvidence(actor, requestNumber, await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }))));
    revalidatePath(`/compte/sav/${requestNumber}`);
    redirect(`/compte/sav/${encodeURIComponent(requestNumber)}?etat=preuves-ajoutees`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(requestNumber ? `/compte/sav/${encodeURIComponent(requestNumber)}?etat=preuve-refusee` : "/compte");
  }
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireVerifiedUser } from "@/lib/auth/session";
import { parseShopOrderCancellationFormData, parseShopOrderNumber } from "@/lib/shop/order-domain";
import { cancelMemberShopOrder } from "@/lib/shop/order-service";
import { parseCustomerRequestForm } from "@/lib/shop/customer-request-domain";
import { createShopCustomerRequest } from "@/lib/shop/customer-request-service";

const CANCELLATION_CONFIRMATION = "CONFIRM_SHOP_ORDER_CANCELLATION";

export async function cancelShopOrderAction(formData: FormData) {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  let cancellation;
  try {
    cancellation = parseShopOrderCancellationFormData(formData);
  } catch {
    redirect("/compte?achat=annulation-refusee");
  }
  const session = await requireVerifiedUser("/compte");
  if (session.user.role !== "MEMBER" && session.user.role !== "CUSTOMER") {
    redirect("/compte?achat=annulation-refusee");
  }
  const orderNumber = parseShopOrderNumber(cancellation.orderNumber);
  if (cancellation.confirmation !== CANCELLATION_CONFIRMATION) {
    redirect(`/compte/achats/${encodeURIComponent(orderNumber)}?etat=confirmation-requise`);
  }
  try {
    await cancelMemberShopOrder(session.user.id, orderNumber);
  } catch {
    redirect(`/compte/achats/${encodeURIComponent(orderNumber)}?etat=annulation-refusee`);
  }
  revalidatePath("/compte");
  revalidatePath(`/compte/achats/${orderNumber}`);
  redirect(`/compte/achats/${encodeURIComponent(orderNumber)}?etat=commande-annulee`);
}

export async function createShopCustomerRequestAction(formData: FormData) {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) throw new Error("Origine refusée.");
  let orderNumber = "";
  try {
    const input = parseCustomerRequestForm(formData);
    orderNumber = parseShopOrderNumber(input.orderNumber);
    const session = await requireVerifiedUser("/compte");
    if (session.user.role !== "MEMBER" && session.user.role !== "CUSTOMER") throw new Error("Rôle refusé.");
    await createShopCustomerRequest({ id: session.user.id, role: session.user.role, status: session.user.status, emailVerified: session.user.emailVerified }, input);
    revalidatePath(`/compte/achats/${orderNumber}`);
    redirect(`/compte/achats/${encodeURIComponent(orderNumber)}?etat=demande-transmise`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(orderNumber ? `/compte/achats/${encodeURIComponent(orderNumber)}?etat=demande-refusee` : "/compte");
  }
}

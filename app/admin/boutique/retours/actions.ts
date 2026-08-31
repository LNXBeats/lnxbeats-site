"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import {
  parseInspectionCondition,
  parseQuantityMap,
  parseRestockDecision,
  parseShopReturnRequestNumber,
  SHOP_RETURN_APPROVAL_CONFIRMATION,
  SHOP_RETURN_CLOSE_CONFIRMATION,
  SHOP_RETURN_INSPECTION_CONFIRMATION,
  SHOP_RETURN_RECEIPT_CONFIRMATION,
  SHOP_RETURN_REFUND_CONFIRMATION,
  SHOP_RETURN_REJECTION_CONFIRMATION,
  SHOP_RETURN_RESTOCK_CONFIRMATION,
} from "@/lib/shop/after-sales-domain";
import {
  closeShopReturn,
  createFakeShopRefundGateway,
  decideShopReturn,
  inspectShopReturn,
  markShopReturnReceived,
  reconcileShopReturnRefund,
  requestShopReturnRefund,
  restockShopReturn,
  startShopReturnReview,
} from "@/lib/shop/after-sales-service";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  const session = await requireAdmin();
  return { id: session.user.id, role: "ADMIN", status: session.user.status, emailVerified: session.user.emailVerified } as const;
}

function value(formData: FormData, name: string, maximum: number, required = true) {
  const candidate = formData.get(name);
  if (typeof candidate !== "string") throw new Error("Champ invalide.");
  const normalized = candidate.trim().replace(/\s+/g, " ");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("Champ invalide.");
  return normalized || null;
}

function refresh(requestNumber: string) {
  revalidatePath("/admin/boutique/retours");
  revalidatePath(`/admin/boutique/retours/${requestNumber}`);
  revalidatePath("/compte");
  revalidatePath(`/compte/sav/${requestNumber}`);
}

async function run(formData: FormData, operation: (actor: Awaited<ReturnType<typeof authorize>>, requestNumber: string) => Promise<unknown>, state: string) {
  const actor = await authorize();
  let requestNumber = "";
  try {
    requestNumber = parseShopReturnRequestNumber(formData.get("requestNumber"));
    await operation(actor, requestNumber);
    refresh(requestNumber);
    redirect(`/admin/boutique/retours/${encodeURIComponent(requestNumber)}?etat=${state}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(requestNumber ? `/admin/boutique/retours/${encodeURIComponent(requestNumber)}?etat=operation-refusee` : "/admin/boutique/retours?etat=operation-refusee");
  }
}

export async function startShopReturnReviewAction(formData: FormData) {
  return run(formData, startShopReturnReview, "revue-demarree");
}

export async function decideShopReturnAction(formData: FormData) {
  const decision = formData.get("decision");
  const expected = decision === "APPROVE" ? SHOP_RETURN_APPROVAL_CONFIRMATION : SHOP_RETURN_REJECTION_CONFIRMATION;
  if ((decision !== "APPROVE" && decision !== "REJECT") || formData.get("confirmation") !== expected) redirect("/admin/boutique/retours?etat=confirmation-requise");
  return run(formData, async (actor, requestNumber) => {
    const returnCostDecision = value(formData, "returnCostDecision", 32) as "CUSTOMER" | "MERCHANT" | "MANUAL_REVIEW";
    if (!["CUSTOMER", "MERCHANT", "MANUAL_REVIEW"].includes(returnCostDecision)) throw new Error("Décision invalide.");
    await decideShopReturn(actor, {
      requestNumber,
      decision,
      authorizedQuantities: parseQuantityMap(formData, "authorized:"),
      physicalReturnRequired: formData.get("physicalReturnRequired") === "true",
      returnCostDecision,
      instructions: value(formData, "instructions", 2000, false),
      comment: value(formData, "comment", 1000, false),
    }, new Date(), {
      immediateRefund: decision === "APPROVE" && formData.get("physicalReturnRequired") !== "true",
      refundGateway: createFakeShopRefundGateway("SUCCEEDED"),
    });
  }, decision === "APPROVE" ? "demande-acceptee" : "demande-refusee");
}

export async function receiveShopReturnAction(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_RETURN_RECEIPT_CONFIRMATION) redirect("/admin/boutique/retours?etat=confirmation-requise");
  return run(formData, (actor, requestNumber) => markShopReturnReceived(actor, requestNumber, parseQuantityMap(formData, "received:")), "retour-recu");
}

export async function inspectShopReturnAction(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_RETURN_INSPECTION_CONFIRMATION) redirect("/admin/boutique/retours?etat=confirmation-requise");
  return run(formData, async (actor, requestNumber) => {
    const refundable = parseQuantityMap(formData, "refundable:");
    const restockable = parseQuantityMap(formData, "restockable:");
    const lines = new Map();
    for (const [productId, refundableQuantity] of refundable) {
      lines.set(productId, {
        condition: parseInspectionCondition(formData.get(`condition:${productId}`)),
        decision: parseRestockDecision(formData.get(`decision:${productId}`)),
        refundableQuantity,
        restockableQuantity: restockable.get(productId) ?? 0,
        comment: value(formData, `comment:${productId}`, 1000, false),
      });
    }
    await inspectShopReturn(actor, { requestNumber, lines });
  }, "inspection-enregistree");
}

export async function refundShopReturnAction(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_RETURN_REFUND_CONFIRMATION) redirect("/admin/boutique/retours?etat=confirmation-requise");
  const behavior = formData.get("behavior");
  if (!["SUCCEEDED", "PENDING", "FAILED", "AMBIGUOUS"].includes(String(behavior))) redirect("/admin/boutique/retours?etat=operation-refusee");
  return run(formData, (actor, requestNumber) => requestShopReturnRefund(
    actor,
    requestNumber,
    formData.get("shippingDecision") === "FULL" ? "FULL" : "NONE",
    createFakeShopRefundGateway(behavior as "SUCCEEDED" | "PENDING" | "FAILED" | "AMBIGUOUS"),
  ), "remboursement-traite");
}

export async function reconcileShopReturnAction(formData: FormData) {
  return run(formData, (actor, requestNumber) => reconcileShopReturnRefund(actor, requestNumber, createFakeShopRefundGateway("SUCCEEDED")), "remboursement-reconcilie");
}

export async function restockShopReturnAction(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_RETURN_RESTOCK_CONFIRMATION) redirect("/admin/boutique/retours?etat=confirmation-requise");
  return run(formData, restockShopReturn, "stock-reintegre");
}

export async function closeShopReturnAction(formData: FormData) {
  if (formData.get("confirmation") !== SHOP_RETURN_CLOSE_CONFIRMATION) redirect("/admin/boutique/retours?etat=confirmation-requise");
  return run(formData, closeShopReturn, "dossier-clos");
}

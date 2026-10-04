"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import {
  ADMIN_EXTERNAL_PRODUCT_FORM_FIELDS,
  assertExternalProductConfirmation,
  externalProductEditorPayload,
  strictExternalProductFormData,
} from "@/lib/shop/external-product-admin-form";
import {
  EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS,
  parseExternalProductIdentity,
  parseExternalProductLockVersion,
} from "@/lib/shop/external-product-domain";
import {
  archiveAdminExternalProduct,
  createAdminExternalProduct,
  publishAdminExternalProduct,
  unpublishAdminExternalProduct,
  updateAdminExternalProduct,
} from "@/lib/shop/external-product-service";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) throw new Error("Origine refusée.");
  return requireAdmin();
}

function refresh(id?: string) {
  revalidatePath("/admin/boutique");
  if (id) revalidatePath(`/admin/boutique/externe/${id}`);
  revalidatePath("/boutique");
}

function state(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "CONFLICT" ? "conflit"
    : error instanceof Error && "code" in error && error.code === "INCOMPLETE" ? "publication-incomplete"
      : "operation-refusee";
}

export async function createExternalProductAction(formData: FormData) {
  const session = await authorize();
  try {
    const input = strictExternalProductFormData(formData, ADMIN_EXTERNAL_PRODUCT_FORM_FIELDS);
    const product = await createAdminExternalProduct(externalProductEditorPayload(input), session.user.id);
    refresh(product.id);
    redirect(`/admin/boutique/externe/${product.id}?etat=produit-cree`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/boutique/externe/nouveau?etat=${state(error)}`);
  }
}

export async function updateExternalProductAction(formData: FormData) {
  const session = await authorize();
  let id = "";
  try {
    const input = strictExternalProductFormData(formData, [...ADMIN_EXTERNAL_PRODUCT_FORM_FIELDS, "productId", "lockVersion"]);
    id = parseExternalProductIdentity(input.productId);
    const product = await updateAdminExternalProduct(id, parseExternalProductLockVersion(input.lockVersion), externalProductEditorPayload(input), session.user.id);
    refresh(product.id);
    redirect(`/admin/boutique/externe/${product.id}?etat=produit-enregistre`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(id ? `/admin/boutique/externe/${id}?etat=${state(error)}` : `/admin/boutique?etat=${state(error)}`);
  }
}

async function lifecycle(formData: FormData, operation: (id: string, version: number, actor: string) => Promise<{ id: string }>, confirmation: string, success: string) {
  const session = await authorize();
  let id = "";
  try {
    const input = strictExternalProductFormData(formData, ["productId", "lockVersion", "confirmation"]);
    id = parseExternalProductIdentity(input.productId);
    assertExternalProductConfirmation(input.confirmation, confirmation);
    const product = await operation(id, parseExternalProductLockVersion(input.lockVersion), session.user.id);
    refresh(product.id);
    redirect(`/admin/boutique/externe/${product.id}?etat=${success}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(id ? `/admin/boutique/externe/${id}?etat=${state(error)}` : `/admin/boutique?etat=${state(error)}`);
  }
}

export async function publishExternalProductAction(formData: FormData) { return lifecycle(formData, publishAdminExternalProduct, EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.publish, "produit-publie"); }
export async function unpublishExternalProductAction(formData: FormData) { return lifecycle(formData, unpublishAdminExternalProduct, EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.unpublish, "produit-depublie"); }
export async function archiveExternalProductAction(formData: FormData) { return lifecycle(formData, archiveAdminExternalProduct, EXTERNAL_PRODUCT_ACTION_CONFIRMATIONS.archive, "produit-archive"); }

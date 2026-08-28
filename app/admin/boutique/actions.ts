"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import {
  ADMIN_PRODUCT_EDITOR_FORM_FIELDS,
  ProductAdminFormError,
  adminProductEditorPayload,
  assertAdminProductConfirmation,
  strictAdminProductFormData,
} from "@/lib/shop/product-admin-form";
import {
  parseProductIdentity,
  parseProductLockVersion,
  PRODUCT_ACTION_CONFIRMATIONS,
} from "@/lib/shop/product-domain";
import {
  adjustAdminProductStock,
  archiveAdminProduct,
  createAdminProduct,
  getAdminProductSlugById,
  ProductServiceError,
  publishAdminProduct,
  unpublishAdminProduct,
  updateAdminProduct,
} from "@/lib/shop/product-service";
import {
  parseShopPreparingForm,
  parseShopShippedForm,
} from "@/lib/shop/fulfillment-domain";
import {
  markShopOrderPreparing,
  markShopOrderShipped,
} from "@/lib/shop/fulfillment-service";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  return requireAdmin();
}

function refreshProduct(slug: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/boutique");
  revalidatePath(`/admin/boutique/${slug}`);
  revalidatePath("/boutique");
}

function stateForError(error: unknown) {
  if (error instanceof ProductAdminFormError && error.code === "CONFIRMATION_REQUIRED") return "confirmation-requise";
  if (error instanceof ProductServiceError && error.code === "CONFLICT") return "conflit";
  if (error instanceof ProductServiceError && error.code === "SLUG_TAKEN") return "slug-occupe";
  if (error instanceof ProductServiceError && error.code === "SLUG_IMMUTABLE") return "slug-immuable";
  if (error instanceof ProductServiceError && error.code === "STOCK_CONFIRMATION_REQUIRED") return "confirmation-requise";
  if (error instanceof ProductServiceError && error.code === "ACTIVE_RESERVATIONS") return "stock-reserve";
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("PUBLICATION_BLOCKED")) return "publication-incomplete";
  return "operation-refusee";
}

function requireExactConfirmation(value: unknown, expected: string) {
  if (value !== expected) redirect("/admin/boutique?etat=confirmation-requise");
}

export async function createProductAction(formData: FormData) {
  const session = await authorize();
  let product;
  try {
    const input = strictAdminProductFormData(formData, ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
    product = await createAdminProduct(adminProductEditorPayload(input), session.user.id);
  } catch (error) {
    redirect(`/admin/boutique/nouveau?etat=${encodeURIComponent(stateForError(error))}`);
  }
  refreshProduct(product.slug);
  redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=produit-cree`);
}

export async function updateProductAction(formData: FormData) {
  const session = await authorize();
  try {
    const input = strictAdminProductFormData(formData, [...ADMIN_PRODUCT_EDITOR_FORM_FIELDS, "productId", "lockVersion", "confirmation"]);
    const productId = parseProductIdentity(input.productId);
    const lockVersion = parseProductLockVersion(input.lockVersion);
    const product = await updateAdminProduct(
      productId,
      lockVersion,
      adminProductEditorPayload(input),
      session.user.id,
      { stockChangeConfirmed: input.confirmation === PRODUCT_ACTION_CONFIRMATIONS.stock },
    );
    refreshProduct(product.slug);
    redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=produit-enregistre`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/boutique?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

async function lifecycleAction(
  formData: FormData,
  operation: (productId: string, lockVersion: number, actorUserId: string) => Promise<{ slug: string }>,
  successState: string,
  expectedConfirmation: string,
) {
  const input = strictAdminProductFormData(formData, ["productId", "lockVersion", "confirmation"]);
  const productId = parseProductIdentity(input.productId);
  const lockVersion = parseProductLockVersion(input.lockVersion);
  const session = await authorize();
  requireExactConfirmation(input.confirmation, expectedConfirmation);
  try {
    const product = await operation(productId, lockVersion, session.user.id);
    refreshProduct(product.slug);
    redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=${encodeURIComponent(successState)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/boutique?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function publishProductAction(formData: FormData) {
  return lifecycleAction(
    formData,
    publishAdminProduct,
    "produit-publie",
    PRODUCT_ACTION_CONFIRMATIONS.publish,
  );
}

export async function unpublishProductAction(formData: FormData) {
  return lifecycleAction(
    formData,
    unpublishAdminProduct,
    "produit-depublie",
    PRODUCT_ACTION_CONFIRMATIONS.unpublish,
  );
}

export async function archiveProductAction(formData: FormData) {
  return lifecycleAction(
    formData,
    archiveAdminProduct,
    "produit-archive",
    PRODUCT_ACTION_CONFIRMATIONS.archive,
  );
}

export async function adjustProductStockAction(formData: FormData) {
  const session = await authorize();
  let productId: string | null = null;
  try {
    const input = strictAdminProductFormData(formData, ["productId", "lockVersion", "delta", "reason", "confirmation"]);
    productId = parseProductIdentity(input.productId);
    const lockVersion = parseProductLockVersion(input.lockVersion);
    assertAdminProductConfirmation(input.confirmation, PRODUCT_ACTION_CONFIRMATIONS.stock);
    const product = await adjustAdminProductStock(
      productId,
      lockVersion,
      { delta: input.delta, reason: input.reason },
      session.user.id,
    );
    refreshProduct(product.slug);
    redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=stock-ajuste`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (productId) {
      const product = await getAdminProductSlugById(productId);
      if (product) redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=${encodeURIComponent(stateForError(error))}`);
    }
    redirect(`/admin/boutique?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

function refreshShopOrder(orderNumber: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/boutique/commandes");
  revalidatePath(`/admin/boutique/commandes/${orderNumber}`);
  revalidatePath("/compte");
  revalidatePath(`/compte/achats/${orderNumber}`);
}

export async function markShopOrderPreparingAction(formData: FormData) {
  const session = await authorize();
  let orderNumber: string;
  try {
    ({ orderNumber } = parseShopPreparingForm(formData));
    await markShopOrderPreparing(orderNumber, session.user.id);
  } catch {
    redirect("/admin/boutique/commandes?etat=transition-refusee");
  }
  refreshShopOrder(orderNumber);
  redirect(`/admin/boutique/commandes/${encodeURIComponent(orderNumber)}?etat=preparation-demarree`);
}

export async function markShopOrderShippedAction(formData: FormData) {
  const session = await authorize();
  let orderNumber: string;
  try {
    const input = parseShopShippedForm(formData);
    orderNumber = input.orderNumber;
    await markShopOrderShipped(orderNumber, session.user.id, input.shipment);
  } catch {
    redirect("/admin/boutique/commandes?etat=transition-refusee");
  }
  refreshShopOrder(orderNumber);
  redirect(`/admin/boutique/commandes/${encodeURIComponent(orderNumber)}?etat=commande-expediee`);
}

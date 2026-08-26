"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import {
  parseProductIdentity,
  parseProductLockVersion,
  PRODUCT_ACTION_CONFIRMATIONS,
} from "@/lib/shop/product-domain";
import {
  adjustAdminProductStock,
  archiveAdminProduct,
  createAdminProduct,
  ProductServiceError,
  publishAdminProduct,
  unpublishAdminProduct,
  updateAdminProduct,
} from "@/lib/shop/product-service";

const PRODUCT_FIELDS = [
  "slug", "title", "description", "priceCents", "currency", "trackInventory", "stock",
  "shippingRequired", "shippingPriceCents", "position",
] as const;

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  return requireAdmin();
}

function strictFormData(formData: FormData, allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!allowed.has(key) || key in result || typeof value !== "string") {
      throw new Error("Formulaire produit invalide.");
    }
    result[key] = value;
  }
  return result;
}

function productEditorPayload(input: Record<string, unknown>) {
  return Object.fromEntries(PRODUCT_FIELDS.filter((field) => field in input).map((field) => [field, input[field]]));
}

function refreshProduct(slug: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/boutique");
  revalidatePath(`/admin/boutique/${slug}`);
  revalidatePath("/boutique");
}

function stateForError(error: unknown) {
  if (error instanceof ProductServiceError && error.code === "CONFLICT") return "conflit";
  if (error instanceof ProductServiceError && error.code === "SLUG_TAKEN") return "slug-occupe";
  if (error instanceof ProductServiceError && error.code === "SLUG_IMMUTABLE") return "slug-immuable";
  if (error instanceof ProductServiceError && error.code === "STOCK_CONFIRMATION_REQUIRED") return "confirmation-requise";
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("PUBLICATION_BLOCKED")) return "publication-incomplete";
  return "operation-refusee";
}

function requireExactConfirmation(value: unknown, expected: string) {
  if (value !== expected) redirect("/admin/boutique?etat=confirmation-requise");
}

export async function createProductAction(formData: FormData) {
  const input = strictFormData(formData, PRODUCT_FIELDS);
  const session = await authorize();
  let product;
  try {
    product = await createAdminProduct(input, session.user.id);
  } catch (error) {
    redirect(`/admin/boutique/nouveau?etat=${encodeURIComponent(stateForError(error))}`);
  }
  refreshProduct(product.slug);
  redirect(`/admin/boutique/${encodeURIComponent(product.slug)}?etat=produit-cree`);
}

export async function updateProductAction(formData: FormData) {
  const input = strictFormData(formData, [...PRODUCT_FIELDS, "productId", "lockVersion", "confirmation"]);
  const productId = parseProductIdentity(input.productId);
  const lockVersion = parseProductLockVersion(input.lockVersion);
  const session = await authorize();
  try {
    const product = await updateAdminProduct(
      productId,
      lockVersion,
      productEditorPayload(input),
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
  const input = strictFormData(formData, ["productId", "lockVersion", "confirmation"]);
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
  const input = strictFormData(formData, ["productId", "lockVersion", "delta", "reason", "confirmation"]);
  const productId = parseProductIdentity(input.productId);
  const lockVersion = parseProductLockVersion(input.lockVersion);
  const session = await authorize();
  requireExactConfirmation(input.confirmation, PRODUCT_ACTION_CONFIRMATIONS.stock);
  try {
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
    redirect(`/admin/boutique?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

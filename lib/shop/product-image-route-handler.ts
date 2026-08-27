import "server-only";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { PRODUCT_IMAGE_DELETION_CONFIRMATION } from "@/lib/shop/product-domain";
import {
  deleteAdminProductImage,
  ProductImageConflictError,
  ProductImageError,
  replaceAdminProductImage,
  updateAdminProductImageAlt,
} from "@/lib/shop/product-image";
import {
  ProductImageRequestError,
  readProductImageFormData,
  readProductImageJson,
} from "@/lib/shop/product-image-request";

type AdminSession = { user: { id: string } };

export type ProductImageMutationDependencies = Readonly<{
  baseUrl(): string;
  sameOrigin(request: Request, baseUrl: string): boolean;
  admin(): Promise<AdminSession>;
  readForm(request: Request): Promise<FormData>;
  readJson(request: Request): Promise<unknown>;
  replace(input: Parameters<typeof replaceAdminProductImage>[0]): Promise<{ assetId: string; slug: string }>;
  updateAlt(input: Parameters<typeof updateAdminProductImageAlt>[0]): Promise<{ assetId: string; slug: string }>;
  remove(input: Parameters<typeof deleteAdminProductImage>[0]): Promise<{ slug: string }>;
}>;

export function createProductImageMutationDependencies(
  admin: ProductImageMutationDependencies["admin"],
): ProductImageMutationDependencies {
  return {
    baseUrl: () => process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000",
    sameOrigin: isSameOriginMutation,
    admin,
    readForm: readProductImageFormData,
    readJson: readProductImageJson,
    replace: replaceAdminProductImage,
    updateAlt: updateAdminProductImageAlt,
    remove: deleteAdminProductImage,
  };
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function closedObject(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) return null;
  return object;
}

function strictProductImageForm(formData: FormData) {
  const allowed = new Set(["expectedLockVersion", "expectedAssetId", "alt", "rightsConfirmed", "image"]);
  const seen = new Set<string>();
  for (const [key] of formData.entries()) {
    if (!allowed.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  if (seen.size !== allowed.size) return null;
  const expectedLockVersion = formData.get("expectedLockVersion");
  const expectedAssetId = formData.get("expectedAssetId");
  const alt = formData.get("alt");
  const rightsConfirmed = formData.get("rightsConfirmed");
  const image = formData.get("image");
  if (
    typeof expectedLockVersion !== "string"
    || typeof expectedAssetId !== "string"
    || typeof alt !== "string"
    || rightsConfirmed !== "on"
    || !(image instanceof File)
  ) return null;
  return { expectedLockVersion, expectedAssetId, alt, rightsConfirmed: true, file: image };
}

function errorResponse(error: unknown) {
  if (error instanceof ProductImageRequestError) {
    return json(
      { ok: false, state: error.code === "TRANSPORT_TOO_LARGE" ? "image-trop-lourde" : "image-invalide" },
      error.code === "TRANSPORT_TOO_LARGE" ? 413 : 400,
    );
  }
  if (error instanceof ProductImageConflictError) {
    return json({
      ok: false,
      state: "image-conflit",
      currentAssetId: error.currentAssetId,
      currentLockVersion: error.currentLockVersion,
    }, 409);
  }
  if (error instanceof ProductImageError) {
    const state = error.code === "FILE_TOO_LARGE" ? "image-trop-lourde"
      : error.code === "EMPTY_FILE" || error.code === "NO_IMAGE" ? "image-vide"
        : error.code === "UNREADABLE_IMAGE" ? "image-illisible"
          : error.code === "TOO_MANY_PIXELS" ? "image-dimensions"
            : error.code === "RIGHTS_CONFIRMATION_REQUIRED" ? "image-droits"
              : error.code === "INVALID_ALT" ? "image-alt"
                : error.code === "SHARED_ASSET" ? "image-partagee"
                : error.code === "NOT_DRAFT" ? "image-produit-publie"
                  : error.code === "NOT_FOUND" ? "image-produit-absent"
                    : error.code === "INVALID_PRODUCT_ID" || error.code === "INVALID_VERSION" ? "image-invalide"
                      : "image-format";
    const status = error.code === "NOT_FOUND" ? 404
      : error.code === "NOT_DRAFT" || error.code === "SHARED_ASSET" ? 409
        : 422;
    return json({ ok: false, state }, status);
  }
  return json({ ok: false, state: "image-erreur" }, 500);
}

async function authorizeMutation(request: Request, dependencies: ProductImageMutationDependencies) {
  const baseUrl = dependencies.baseUrl();
  if (!dependencies.sameOrigin(request, baseUrl)) return null;
  const session = await dependencies.admin();
  return { baseUrl, session };
}

function location(baseUrl: string, slug: string, state: string) {
  return new URL(`/admin/boutique/${encodeURIComponent(slug)}?etat=${encodeURIComponent(state)}`, baseUrl).toString();
}

export async function handleProductImageUpload(
  request: Request,
  productId: string,
  dependencies: ProductImageMutationDependencies,
) {
  const authorization = await authorizeMutation(request, dependencies);
  if (!authorization) return json({ ok: false }, 403);
  try {
    const form = strictProductImageForm(await dependencies.readForm(request));
    if (!form) return json({ ok: false, state: "image-invalide" }, 400);
    const result = await dependencies.replace({
      productId,
      expectedLockVersion: form.expectedLockVersion,
      expectedAssetId: form.expectedAssetId,
      file: form.file,
      alt: form.alt,
      rightsConfirmed: form.rightsConfirmed,
      actorAdminId: authorization.session.user.id,
    });
    return json({
      ok: true,
      state: "image-enregistree",
      assetId: result.assetId,
      location: location(authorization.baseUrl, result.slug, "image-enregistree"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProductImageAltUpdate(
  request: Request,
  productId: string,
  dependencies: ProductImageMutationDependencies,
) {
  const authorization = await authorizeMutation(request, dependencies);
  if (!authorization) return json({ ok: false }, 403);
  try {
    const body = closedObject(await dependencies.readJson(request), ["expectedLockVersion", "expectedAssetId", "alt"]);
    if (
      !body
      || typeof body.expectedLockVersion !== "number"
      || typeof body.expectedAssetId !== "string"
      || typeof body.alt !== "string"
      || Object.keys(body).length !== 3
    ) {
      return json({ ok: false, state: "image-invalide" }, 400);
    }
    const result = await dependencies.updateAlt({
      productId,
      expectedLockVersion: body.expectedLockVersion,
      expectedAssetId: body.expectedAssetId,
      alt: body.alt,
      actorAdminId: authorization.session.user.id,
    });
    return json({
      ok: true,
      state: "image-alt-enregistre",
      assetId: result.assetId,
      location: location(authorization.baseUrl, result.slug, "image-alt-enregistre"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProductImageDelete(
  request: Request,
  productId: string,
  dependencies: ProductImageMutationDependencies,
) {
  const authorization = await authorizeMutation(request, dependencies);
  if (!authorization) return json({ ok: false }, 403);
  try {
    const body = closedObject(await dependencies.readJson(request), ["expectedLockVersion", "expectedAssetId", "confirmation"]);
    if (
      !body
      || typeof body.expectedLockVersion !== "number"
      || typeof body.expectedAssetId !== "string"
      || body.confirmation !== PRODUCT_IMAGE_DELETION_CONFIRMATION
      || Object.keys(body).length !== 3
    ) return json({ ok: false, state: "image-confirmation" }, 400);
    const result = await dependencies.remove({
      productId,
      expectedLockVersion: body.expectedLockVersion,
      expectedAssetId: body.expectedAssetId,
      actorAdminId: authorization.session.user.id,
    });
    return json({
      ok: true,
      state: "image-supprimee",
      location: location(authorization.baseUrl, result.slug, "image-supprimee"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

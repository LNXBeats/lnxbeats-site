import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { getMediaObject, headMediaObject } from "@/lib/media/storage";
import {
  deleteAdminExternalProductImage,
  getAdminExternalProductImage,
  replaceAdminExternalProductImage,
  updateAdminExternalProductImageAlt,
} from "@/lib/shop/external-product-image";
import {
  createProductImageMutationDependencies,
  handleProductImageAltUpdate,
  handleProductImageDelete,
  handleProductImageUpload,
} from "@/lib/shop/product-image-route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ productId: string }> };
const dependencies = createProductImageMutationDependencies(requireAdmin, {
  replace: replaceAdminExternalProductImage,
  updateAlt: updateAdminExternalProductImageAlt,
  remove: deleteAdminExternalProductImage,
});
const adminLocation = (baseUrl: string, id: string, state: string) => new URL(`/admin/boutique/externe/${encodeURIComponent(id)}?etat=${encodeURIComponent(state)}`, baseUrl).toString();

function refresh() {
  revalidatePath("/admin/boutique");
  revalidatePath("/boutique");
}

async function preview(productId: string, head: boolean) {
  await requireAdmin();
  const asset = await getAdminExternalProductImage(productId);
  if (!asset) return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
  const reference = { storageKey: asset.storageKey, storageBackend: asset.storageBackend, storageProvider: asset.storageProvider, visibility: asset.visibility };
  const object = head ? null : await getMediaObject(reference);
  const media = object ?? await headMediaObject(reference);
  if (media.contentLength !== Number(asset.sizeBytes)) return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
  const headers = new Headers({ "cache-control": "private, no-store", "content-length": String(media.contentLength), "content-type": asset.mimeType, "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff" });
  if (head) return new Response(null, { status: 200, headers });
  if (!object) return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
  return new Response(object.body, { status: 200, headers });
}

export async function GET(_request: Request, context: Context) { return preview((await context.params).productId, false); }
export async function HEAD(_request: Request, context: Context) { return preview((await context.params).productId, true); }
export async function POST(request: Request, context: Context) {
  const response = await handleProductImageUpload(request, (await context.params).productId, dependencies, adminLocation);
  if (response.ok) refresh();
  return response;
}
export async function PATCH(request: Request, context: Context) {
  const response = await handleProductImageAltUpdate(request, (await context.params).productId, dependencies, adminLocation);
  if (response.ok) refresh();
  return response;
}
export async function DELETE(request: Request, context: Context) {
  const response = await handleProductImageDelete(request, (await context.params).productId, dependencies, adminLocation);
  if (response.ok) refresh();
  return response;
}

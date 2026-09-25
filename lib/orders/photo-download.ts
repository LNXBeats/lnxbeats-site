import "server-only";

import { sanitizeOriginalFilename, type OrderActor } from "@/lib/orders/domain";
import { safeContentDisposition } from "@/lib/media/storage/policy";
import { getOrderPhotoForActor } from "@/lib/orders/service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderNumberPattern = /^LNX-[0-9]{4}-[0-9]{6}$/;

type OrderPhoto = NonNullable<Awaited<ReturnType<typeof getOrderPhotoForActor>>>;

export function storedReferenceFilename(originalFilename: string, assetId: string) {
  // Uploads are re-encoded as WebP. The original bytes are not persisted, so
  // never advertise the source JPEG/PNG extension on the downloaded file.
  const stem = sanitizeOriginalFilename(originalFilename).replace(/\.[^.]+$/, "").replace(/^\.+|\.+$/g, "").trim();
  return `${stem || `reference-${assetId}`}.webp`;
}

export async function adminOrderPhotoDownloadResponse(
  actor: OrderActor | null,
  orderNumber: string,
  assetId: string,
  load: typeof getOrderPhotoForActor = getOrderPhotoForActor,
) {
  if (!actor) return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  if (actor.role !== "ADMIN") return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  if (!orderNumberPattern.test(orderNumber) || !uuidPattern.test(assetId)) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const photo: OrderPhoto | null = await load(actor, orderNumber, assetId);
  if (!photo || photo.asset.visibility !== "PRIVATE" || photo.asset.type !== "IMAGE" || photo.asset.mimeType !== "image/webp") {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(photo.buffer, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": safeContentDisposition("attachment", storedReferenceFilename(photo.asset.filename, assetId)),
      "content-length": String(photo.buffer.length),
      "content-type": photo.asset.mimeType,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

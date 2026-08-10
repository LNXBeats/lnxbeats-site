import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { deleteOrderPhoto, enforceOrderRateLimit, getOrderPhotoForActor } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string; assetId: string }> };

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export async function GET(request: Request, context: RouteContext) {
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  const { orderNumber, assetId } = await context.params;
  if (!validUuid(assetId)) return orderJson({ error: "Photo introuvable." }, 404);

  try {
    const photo = await getOrderPhotoForActor(actor, orderNumber, assetId);
    if (!photo) return orderJson({ error: "Photo introuvable." }, 404);
    return new Response(photo.buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": "inline; filename=reference.webp",
        "content-length": String(photo.buffer.length),
        "content-type": photo.asset.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  const { orderNumber, assetId } = await context.params;
  if (!validUuid(assetId)) return orderJson({ error: "Photo introuvable." }, 404);

  try {
    await enforceOrderRateLimit(actor.id, "delete");
    await deleteOrderPhoto(actor, orderNumber, assetId);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

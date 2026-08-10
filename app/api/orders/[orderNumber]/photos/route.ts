import { orderOffer } from "@/data/order-offer";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { addOrderPhotos, enforceOrderRateLimit } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  const declaredContentLength = request.headers.get("content-length");
  if (!declaredContentLength) return orderJson({ error: "La taille de la sélection doit être annoncée." }, 411);
  const contentLength = Number(declaredContentLength);
  if (!Number.isFinite(contentLength) || contentLength < 0) return orderJson({ error: "La taille de la sélection est invalide." }, 400);
  if (contentLength > orderOffer.maxPhotoBytes * orderOffer.maxPhotos + 1024 * 1024) {
    return orderJson({ error: "La sélection de photos est trop volumineuse." }, 413);
  }

  try {
    await enforceOrderRateLimit(actor.id, "upload");
    const formData = await request.formData();
    if (formData.get("rightsConfirmed") !== "true") {
      return orderJson({ error: "Confirmez que vous pouvez communiquer ces photos." }, 400);
    }
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length || files.length > orderOffer.maxPhotos) {
      return orderJson({ error: "Sélectionnez entre une et dix photos." }, 400);
    }
    if (files.some((file) => file.size > orderOffer.maxPhotoBytes)) {
      return orderJson({ error: "Chaque photo doit peser au maximum 10 Mo." }, 413);
    }

    const { orderNumber } = await context.params;
    const order = await addOrderPhotos(actor, orderNumber, await Promise.all(files.map(async (file) => ({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalFilename: file.name,
      declaredMimeType: file.type,
    }))));
    return orderJson({ order }, 201);
  } catch (error) {
    return orderErrorResponse(error);
  }
}

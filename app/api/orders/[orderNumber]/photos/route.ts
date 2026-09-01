import { orderOffer } from "@/data/order-offer";
import { withMemoryDiagnosticOperation } from "@/lib/memory-diagnostics";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { withOrderPhotoMultipartAdmission } from "@/lib/orders/photo-upload-admission";
import {
  assertOrderPhotoMultipartHeaders,
  readOrderPhotoMultipartFormData,
} from "@/lib/orders/photo-upload-request";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import {
  addOrderPhotos,
  enforceOrderRateLimit,
  preflightOrderPhotoUpload,
} from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  try {
    assertOrderPhotoMultipartHeaders(request);
    return await withMemoryDiagnosticOperation("upload", async () => {
      await enforceOrderRateLimit(actor.id, "upload");
      const { orderNumber } = await context.params;
      await preflightOrderPhotoUpload(actor, orderNumber);

      return withOrderPhotoMultipartAdmission(async () => {
        const formData = await readOrderPhotoMultipartFormData(request);
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

        const order = await addOrderPhotos(actor, orderNumber, files.map((file) => ({
          buffer: async () => Buffer.from(await file.arrayBuffer()),
          originalFilename: file.name,
          declaredMimeType: file.type,
          signal: request.signal,
        })));
        return orderJson({ order }, 201);
      }, request.signal);
    });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

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
        if (formData.getAll("rightsConfirmed").length !== 1 || formData.get("rightsConfirmed") !== "true") {
          return orderJson({ error: "Confirmez que vous pouvez communiquer ces photos." }, 400);
        }
        const entries = formData.getAll("files");
        if (entries.length !== 1 || !(entries[0] instanceof File)) {
          return orderJson({ error: "Envoyez une seule photo à la fois.", code: "INVALID_PHOTO_COUNT" }, 400);
        }
        if ([...formData.keys()].some((key) => key !== "files" && key !== "rightsConfirmed")) {
          return orderJson({ error: "La sélection de photos est invalide.", code: "INVALID_MULTIPART" }, 400);
        }
        const file = entries[0];
        if (file.size > orderOffer.maxPhotoBytes) {
          return orderJson({ error: "Chaque photo doit peser au maximum 10 Mio (10 485 760 octets).", code: "FILE_TOO_LARGE" }, 413);
        }

        const order = await addOrderPhotos(actor, orderNumber, [{
          buffer: async () => Buffer.from(await file.arrayBuffer()),
          originalFilename: file.name,
          declaredMimeType: file.type,
          signal: request.signal,
        }]);
        return orderJson({ order }, 201);
      }, request.signal);
    });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

import "server-only";

import {
  ORDER_PHOTO_MULTIPART_MAX_BYTES,
  ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES,
} from "@/data/order-photo-upload";
import { OrderUploadError } from "@/lib/orders/upload";

export { ORDER_PHOTO_MULTIPART_MAX_BYTES } from "@/data/order-photo-upload";

export function assertOrderPhotoMultipartHeaders(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const hasBoundary = parameters.some((parameter) => (
    /^\s*boundary\s*=\s*(?:"[^"\r\n]{1,70}"|[^\s;]{1,70})\s*$/i.test(parameter)
  ));
  if (mediaType?.trim().toLowerCase() !== "multipart/form-data" || !hasBoundary) {
    throw new OrderUploadError("La sélection de photos est invalide.", "INVALID_MULTIPART", 400);
  }

  const declaredContentLength = request.headers.get("content-length");
  if (!declaredContentLength) {
    throw new OrderUploadError(
      "La taille de la sélection doit être annoncée.",
      "CONTENT_LENGTH_REQUIRED",
      411,
    );
  }
  const contentLength = Number(declaredContentLength);
  if (!/^\d+$/.test(declaredContentLength) || !Number.isSafeInteger(contentLength)) {
    throw new OrderUploadError("La taille de la sélection est invalide.", "INVALID_MULTIPART", 400);
  }
  if (contentLength > ORDER_PHOTO_MULTIPART_MAX_BYTES) {
    throw new OrderUploadError(
      "La sélection de photos est trop volumineuse.",
      "TRANSPORT_TOO_LARGE",
      413,
    );
  }
  return contentLength;
}

export async function readOrderPhotoMultipartFormData(request: Request) {
  const declaredContentLength = assertOrderPhotoMultipartHeaders(request);
  let receivedBytes = 0;
  try {
    if (!request.body) throw new OrderUploadError("La sélection de photos est invalide.", "INVALID_MULTIPART", 400);
    const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > ORDER_PHOTO_MULTIPART_MAX_BYTES) {
          throw new OrderUploadError("La sélection de photos est trop volumineuse.", "TRANSPORT_TOO_LARGE", 413);
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (receivedBytes !== declaredContentLength) {
          throw new OrderUploadError("L’envoi de la photo est incomplet. Réessayez cette photo.", "INCOMPLETE_MULTIPART", 400);
        }
      },
    }), { signal: request.signal });
    const formData = await new Response(boundedBody, { headers: request.headers }).formData();
    const photoBytes = [...formData.values()].reduce((sum, value) => sum + (value instanceof File ? value.size : 0), 0);
    if (receivedBytes - photoBytes > ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES) {
      throw new OrderUploadError("Les informations accompagnant la photo sont trop volumineuses.", "MULTIPART_FIELDS_TOO_LARGE", 413);
    }
    return formData;
  } catch (error) {
    if (request.signal.aborted) {
      throw new OrderUploadError(
        "Le traitement des photos a été interrompu.",
        "UPLOAD_ABORTED",
      );
    }
    if (error instanceof OrderUploadError) throw error;
    throw new OrderUploadError("La sélection de photos est invalide.", "INVALID_MULTIPART", 400);
  }
}

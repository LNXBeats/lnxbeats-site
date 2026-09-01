import "server-only";

import { orderOffer } from "@/data/order-offer";
import { OrderUploadError } from "@/lib/orders/upload";

export const ORDER_PHOTO_MULTIPART_MAX_BYTES = (
  orderOffer.maxPhotoBytes * orderOffer.maxPhotos
) + 1024 * 1024;

export function assertOrderPhotoMultipartHeaders(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const hasBoundary = parameters.some((parameter) => (
    /^\s*boundary\s*=\s*(?:"[^"]+"|[^\s;]+)\s*$/i.test(parameter)
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
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new OrderUploadError("La taille de la sélection est invalide.", "INVALID_MULTIPART", 400);
  }
  if (contentLength > ORDER_PHOTO_MULTIPART_MAX_BYTES) {
    throw new OrderUploadError(
      "La sélection de photos est trop volumineuse.",
      "TRANSPORT_TOO_LARGE",
      413,
    );
  }
}

export async function readOrderPhotoMultipartFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    if (request.signal.aborted) {
      throw new OrderUploadError(
        "Le traitement des photos a été interrompu.",
        "UPLOAD_ABORTED",
      );
    }
    throw new OrderUploadError("La sélection de photos est invalide.", "INVALID_MULTIPART", 400);
  }
}

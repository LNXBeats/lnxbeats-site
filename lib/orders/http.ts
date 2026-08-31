import "server-only";

import { OrderServiceError } from "@/lib/orders/service";
import { OrderStorageError } from "@/lib/orders/storage";
import { OrderUploadError } from "@/lib/orders/upload";
import { OrderRequestError } from "@/lib/orders/request";
import { OrderDeliveryError } from "@/lib/orders/delivery";

export function orderJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function orderErrorResponse(error: unknown) {
  if (error instanceof OrderRequestError) {
    return orderJson({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof OrderServiceError) {
    return orderJson({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof OrderUploadError) {
    return orderJson({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof OrderDeliveryError) {
    return orderJson({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof OrderStorageError) {
    return orderJson({ error: "Le stockage privé des références est momentanément indisponible.", code: "STORAGE_UNAVAILABLE" }, 503);
  }
  return orderJson({ error: "La demande ne peut pas être traitée.", code: "ORDER_REQUEST_FAILED" }, 500);
}

import "server-only";

import { MediaStorageError } from "@/lib/media/storage/types";
import { ORDER_DELIVERY_MIME_TYPES, type OrderDeliveryUpload } from "@/lib/orders/audio-request";
import {
  OrderDeliveryError,
  OrderDeliveryProcessingError,
} from "@/lib/orders/delivery";
import { OrderUploadError } from "@/lib/orders/upload";

const orderNumberPattern = /^LNX-[0-9]{4}-[0-9]{6}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeCodePattern = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeCode(value: unknown) {
  return typeof value === "string" && safeCodePattern.test(value) ? value : null;
}

function safeMimeType(value: unknown) {
  return typeof value === "string" && (ORDER_DELIVERY_MIME_TYPES as readonly string[]).includes(value)
    ? value
    : null;
}

function mediaError(error: unknown) {
  if (error instanceof MediaStorageError) return error;
  if (error instanceof OrderDeliveryProcessingError && error.originalError instanceof MediaStorageError) {
    return error.originalError;
  }
  return null;
}

export function orderDeliveryFailureDiagnostic(input: {
  orderNumber: string;
  error: unknown;
  source: OrderDeliveryUpload | null;
  declaredLength: string | null;
}) {
  const storageError = mediaError(input.error);
  const sizeBytes = input.source?.sizeBytes
    ?? (() => {
      const parsed = Number(input.declaredLength);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    })();
  const stage = input.error instanceof OrderDeliveryProcessingError
    ? input.error.stage
    : input.error instanceof OrderUploadError
      ? input.error.code === "STREAM_CLOSED_EARLY" ? "request_stream" : "request_validation"
      : input.error instanceof OrderDeliveryError ? "business_rule" : "request_processing";
  const errorCode = input.error instanceof OrderDeliveryError || input.error instanceof OrderUploadError
    ? safeCode(input.error.code)
    : null;

  return {
    event: "order.delivery.upload.failed",
    stage,
    orderNumber: orderNumberPattern.test(input.orderNumber) ? input.orderNumber : "INVALID",
    orderId: input.error instanceof OrderDeliveryProcessingError
      && input.error.orderId
      && uuidPattern.test(input.error.orderId)
      ? input.error.orderId
      : null,
    sizeBytes,
    mimeType: safeMimeType(input.source?.mimeType),
    errorClass: input.error instanceof OrderDeliveryProcessingError
      ? "OrderDeliveryProcessingError"
      : input.error instanceof OrderDeliveryError
        ? "OrderDeliveryError"
        : input.error instanceof OrderUploadError
          ? "OrderUploadError"
          : "UnknownError",
    causeClass: input.error instanceof OrderDeliveryProcessingError
      ? input.error.originalError instanceof MediaStorageError
        ? "MediaStorageError"
        : input.error.originalError instanceof Error
          ? "Error"
          : "UnknownError"
      : null,
    errorCode,
    providerCode: safeCode(storageError?.providerCode),
    providerStatusCode: storageError?.providerStatusCode ?? null,
    cleanupOutcome: input.error instanceof OrderDeliveryProcessingError
      ? input.error.cleanupOutcome
      : "not_required",
  } as const;
}

export function logOrderDeliveryUploadFailure(input: Parameters<typeof orderDeliveryFailureDiagnostic>[0]) {
  console.error(JSON.stringify(orderDeliveryFailureDiagnostic(input)));
}

import "server-only";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { initializeDeliveryUpload, deliveryPartUrl, deliveryUploadStatus, completeDeliveryUpload, abortDeliveryUpload } from "@/lib/orders/delivery-direct-service";
import { OrderDeliveryError } from "@/lib/orders/delivery";

const defaults = { allowed: isAllowedOrderMutation, actor: orderActorFromHeaders, limit: enforceOrderRateLimit,
  init: initializeDeliveryUpload, part: deliveryPartUrl, status: deliveryUploadStatus, complete: completeDeliveryUpload, abort: abortDeliveryUpload };
export async function handleDeliveryDirectUpload(request: Request, orderNumber: string, operation: string, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  if (!deps.allowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await deps.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  if (actor.role !== "ADMIN") return orderJson({ error: "Action réservée à l’administration." }, 403);
  try {
    if (!["init", "part-url", "status", "complete", "abort"].includes(operation)) throw new OrderDeliveryError("Action inconnue.", 404, "INVALID_OPERATION");
    // Polling and the 25 part URLs of a 200 MiB upload must not consume the
    // legacy per-file rate-limit budget. Each initialization is still limited.
    if (operation === "init") await deps.limit(actor.id, "upload");
    const input = await readOrderJson(request, 16_384);
    if (operation === "init") return orderJson(await deps.init(actor, orderNumber, input));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OrderDeliveryError("Métadonnées invalides.", 400, "INVALID_REQUEST");
    const body = input as Record<string, unknown>;
    const keys = operation === "part-url" ? ["sessionToken", "partNumber"] : ["sessionToken"];
    if (Object.keys(body).some((key) => !keys.includes(key))) throw new OrderDeliveryError("Métadonnées invalides.", 400, "INVALID_REQUEST");
    if (operation === "part-url") return orderJson(await deps.part(actor, orderNumber, body.sessionToken, body.partNumber));
    if (operation === "status") return orderJson(await deps.status(actor, orderNumber, body.sessionToken));
    if (operation === "complete") return orderJson(await deps.complete(actor, orderNumber, body.sessionToken));
    return orderJson(await deps.abort(actor, orderNumber, body.sessionToken));
  } catch (error) { return orderErrorResponse(error); }
}

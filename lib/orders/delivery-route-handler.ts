import "server-only";

import { readOrderDeliveryUpload, type OrderDeliveryUpload } from "@/lib/orders/audio-request";
import { orderDeliveryResponse } from "@/lib/orders/audio-response";
import { getOrderDeliveryForActor, putOrderDelivery, removeOrderDelivery } from "@/lib/orders/delivery";
import { logOrderDeliveryUploadFailure } from "@/lib/orders/delivery-observability";
import type { OrderActor } from "@/lib/orders/domain";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { enforceOrderRateLimit } from "@/lib/orders/service";

export type DeliveryRouteAsset = NonNullable<Awaited<ReturnType<typeof getOrderDeliveryForActor>>>;

export async function handleAdminDeliveryUpload(
  request: Request,
  orderNumber: string,
  dependencies: {
    isAllowed(request: Request): boolean;
    actor(headers: Headers): Promise<OrderActor | null>;
    rateLimit(actorId: string): Promise<void>;
    read(request: Request): Promise<OrderDeliveryUpload>;
    put(actor: OrderActor, orderNumber: string, source: OrderDeliveryUpload): Promise<{
      id: string;
      type: "AUDIO" | "DOCUMENT" | "IMAGE";
      filename: string;
      mimeType: string;
      sizeBytes: bigint;
      durationMs: number | null;
      width: number | null;
      height: number | null;
      createdAt: Date;
    }>;
    logFailure?(input: {
      orderNumber: string;
      error: unknown;
      source: OrderDeliveryUpload | null;
      declaredLength: string | null;
    }): void;
  } = {
    isAllowed: isAllowedOrderMutation,
    actor: orderActorFromHeaders,
    rateLimit: (actorId) => enforceOrderRateLimit(actorId, "upload"),
    read: readOrderDeliveryUpload,
    put: putOrderDelivery,
    logFailure: logOrderDeliveryUploadFailure,
  },
) {
  if (!dependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await dependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  if (actor.role !== "ADMIN") return orderJson({ error: "Action réservée à l’administration." }, 403);

  let source: OrderDeliveryUpload | null = null;
  try {
    await dependencies.rateLimit(actor.id);
    source = await dependencies.read(request);
    const delivery = await dependencies.put(actor, orderNumber, source);
    return orderJson({
      delivery: {
        id: delivery.id,
        type: delivery.type,
        filename: delivery.filename,
        mimeType: delivery.mimeType,
        sizeBytes: Number(delivery.sizeBytes),
        durationMs: delivery.durationMs,
        width: delivery.width,
        height: delivery.height,
        createdAt: delivery.createdAt.toISOString(),
      },
    }, 201);
  } catch (error) {
    (dependencies.logFailure ?? logOrderDeliveryUploadFailure)({
      orderNumber,
      error,
      source,
      declaredLength: request.headers.get("content-length"),
    });
    return orderErrorResponse(error);
  } finally {
    if (source) await source.cleanup().catch(() => undefined);
  }
}

export async function handleAdminDeliveryDelete(
  request: Request,
  input: { orderNumber: string; assetId: string },
  dependencies: {
    isAllowed(request: Request): boolean;
    actor(headers: Headers): Promise<OrderActor | null>;
    rateLimit(actorId: string): Promise<void>;
    remove(actor: OrderActor, orderNumber: string, assetId: string): Promise<void>;
  } = {
    isAllowed: isAllowedOrderMutation,
    actor: orderActorFromHeaders,
    rateLimit: (actorId) => enforceOrderRateLimit(actorId, "delete"),
    remove: removeOrderDelivery,
  },
) {
  if (!dependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await dependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  if (actor.role !== "ADMIN") return orderJson({ error: "Action réservée à l’administration." }, 403);
  try {
    await dependencies.rateLimit(actor.id);
    await dependencies.remove(actor, input.orderNumber, input.assetId);
    return orderJson({ removed: true });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

export async function handleOrderDeliveryDownload(
  request: Request,
  input: { orderNumber: string; assetId: string; head?: boolean; download?: boolean },
  dependencies: {
    actor(headers: Headers): Promise<OrderActor | null>;
    get(actor: OrderActor, orderNumber: string, assetId: string): Promise<DeliveryRouteAsset | null>;
    respond(request: Request, asset: DeliveryRouteAsset, options: { head: boolean; download: boolean }): Promise<Response>;
  } = {
    actor: orderActorFromHeaders,
    get: getOrderDeliveryForActor,
    respond: orderDeliveryResponse,
  },
) {
  const actor = await dependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.assetId)) {
    return orderJson({ error: "Livraison introuvable." }, 404);
  }
  try {
    const asset = await dependencies.get(actor, input.orderNumber, input.assetId);
    if (!asset) return orderJson({ error: "Livraison introuvable." }, 404);
    return dependencies.respond(request, asset, {
      head: input.head === true,
      download: input.download !== false,
    });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

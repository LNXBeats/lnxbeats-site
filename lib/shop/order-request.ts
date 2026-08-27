import "server-only";

import { OrderRequestError, isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import { ShopDomainError, parseShopIdempotencyKey, parseShopOrderIntent } from "@/lib/shop/order-domain";
import { ShopServiceError, createShopOrder, type ShopOrderActor } from "@/lib/shop/order-service";

export type ShopOrderHttpResult = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
}>;

type CreatedOrderSnapshot = Readonly<{
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  reservationExpiresAt: Date;
}>;

export type ShopOrderRequestDependencies = Readonly<{
  allowed(request: Request): boolean;
  actor(headers: Headers): Promise<ShopOrderActor | null>;
  readJson(request: Request): Promise<unknown>;
  create(
    actor: ShopOrderActor,
    intent: ReturnType<typeof parseShopOrderIntent>,
    creationToken: string,
  ): Promise<CreatedOrderSnapshot>;
}>;

const defaultDependencies: ShopOrderRequestDependencies = {
  allowed: isAllowedOrderMutation,
  actor: orderActorFromHeaders,
  readJson: readOrderJson,
  create: createShopOrder,
};

function failure(error: unknown): ShopOrderHttpResult {
  if (error instanceof ShopDomainError || error instanceof ShopServiceError || error instanceof OrderRequestError) {
    return {
      status: error.status,
      body: {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error instanceof ShopServiceError && error.productId ? { productId: error.productId } : {}),
      },
    };
  }
  console.error(JSON.stringify({ event: "shop.order.create.failed", code: "INTERNAL_ERROR" }));
  return {
    status: 500,
    body: {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "La commande Boutique n’a pas pu être préparée.",
    },
  };
}

export async function handleCreateShopOrder(
  request: Request,
  dependencies: ShopOrderRequestDependencies = defaultDependencies,
): Promise<ShopOrderHttpResult> {
  if (!dependencies.allowed(request)) {
    return { status: 403, body: { ok: false, code: "ORIGIN_REFUSED", message: "Origine refusée." } };
  }
  try {
    const actor = await dependencies.actor(request.headers);
    if (!actor) {
      return {
        status: 401,
        body: { ok: false, code: "AUTH_REQUIRED", message: "Connectez-vous pour préparer cet achat." },
      };
    }
    const creationToken = parseShopIdempotencyKey(request.headers.get("idempotency-key"));
    const intent = parseShopOrderIntent(await dependencies.readJson(request));
    const order = await dependencies.create(actor, intent, creationToken);
    return {
      status: 201,
      body: {
        ok: true,
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          subtotalCents: order.subtotalCents,
          shippingCents: order.shippingCents,
          totalCents: order.totalCents,
          currency: order.currency,
          reservationExpiresAt: order.reservationExpiresAt.toISOString(),
        },
      },
    };
  } catch (error) {
    return failure(error);
  }
}

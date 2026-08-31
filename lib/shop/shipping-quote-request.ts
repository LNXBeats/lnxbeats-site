import "server-only";

import {
  isAllowedOrderMutation,
  orderActorFromHeaders,
  OrderRequestError,
  readOrderJson,
} from "@/lib/orders/request";
import { parseShopShippingQuoteIntent, ShopDomainError } from "@/lib/shop/order-domain";
import {
  quoteShopOrderShipping,
  ShopServiceError,
  type ShopOrderActor,
} from "@/lib/shop/order-service";

export type ShopShippingQuoteHttpResult = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
}>;

type QuoteSnapshot = Awaited<ReturnType<typeof quoteShopOrderShipping>>;

export type ShopShippingQuoteRequestDependencies = Readonly<{
  allowed(request: Request): boolean;
  actor(headers: Headers): Promise<ShopOrderActor | null>;
  readJson(request: Request): Promise<unknown>;
  quote(actor: ShopOrderActor, intent: ReturnType<typeof parseShopShippingQuoteIntent>): Promise<QuoteSnapshot>;
}>;

const defaultDependencies: ShopShippingQuoteRequestDependencies = {
  allowed: isAllowedOrderMutation,
  actor: orderActorFromHeaders,
  readJson: readOrderJson,
  quote: quoteShopOrderShipping,
};

function failure(error: unknown): ShopShippingQuoteHttpResult {
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
  console.error(JSON.stringify({ event: "shop.shipping.quote.failed", code: "INTERNAL_ERROR" }));
  return {
    status: 500,
    body: {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Le devis de livraison n’a pas pu être calculé.",
    },
  };
}
export async function handleShopShippingQuote(
  request: Request,
  dependencies: ShopShippingQuoteRequestDependencies = defaultDependencies,
): Promise<ShopShippingQuoteHttpResult> {
  if (!dependencies.allowed(request)) {
    return { status: 403, body: { ok: false, code: "ORIGIN_REFUSED", message: "Origine refusée." } };
  }
  try {
    const actor = await dependencies.actor(request.headers);
    if (!actor) {
      return { status: 401, body: { ok: false, code: "AUTH_REQUIRED", message: "Connectez-vous pour calculer la livraison." } };
    }
    const quote = await dependencies.quote(actor, parseShopShippingQuoteIntent(await dependencies.readJson(request)));
    return {
      status: 200,
      body: { ok: true, quote },
    };
  } catch (error) {
    return failure(error);
  }
}

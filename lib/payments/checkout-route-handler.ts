import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import {
  createStripeCheckoutForOrder,
  PaymentServiceError,
  type StripeCheckoutResult,
} from "@/lib/payments/service";
import { loadAndAssertPaymentQaRuntimeEnvironment } from "@/lib/payments/qa-guard";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export type CheckoutRouteDependencies = Readonly<{
  isAllowedMutation(request: Request): boolean;
  assertQaRuntime(): Promise<void>;
  actorFromHeaders(headers: Headers): Promise<OrderActor | null>;
  createCheckout(actor: OrderActor, orderNumber: string): Promise<StripeCheckoutResult>;
}>;

const checkoutRouteDependencies: CheckoutRouteDependencies = {
  isAllowedMutation: isAllowedOrderMutation,
  assertQaRuntime: async () => {
    await loadAndAssertPaymentQaRuntimeEnvironment();
  },
  actorFromHeaders: orderActorFromHeaders,
  createCheckout: createStripeCheckoutForOrder,
};

function paymentJson(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleStripeCheckoutPost(
  request: Request,
  context: RouteContext,
  dependencies: CheckoutRouteDependencies = checkoutRouteDependencies,
) {
  if (!dependencies.isAllowedMutation(request)) {
    return paymentJson({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_ACCESS_DENIED" }, 403);
  }

  try {
    await dependencies.assertQaRuntime();
  } catch {
    return paymentJson({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503);
  }

  let actor: OrderActor | null;
  try {
    actor = await dependencies.actorFromHeaders(request.headers);
  } catch {
    return paymentJson({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503);
  }
  if (!actor || actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    return paymentJson({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_ACCESS_DENIED" }, actor ? 403 : 401);
  }

  try {
    const { orderNumber } = await context.params;
    return paymentJson(await dependencies.createCheckout(actor, orderNumber), 200);
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return paymentJson({ error: error.message, code: error.code }, error.status);
    }
    return paymentJson({ error: "Le paiement ne peut pas être préparé.", code: "PAYMENT_UNAVAILABLE" }, 503);
  }
}

import "server-only";

import type { OrderActor } from "@/lib/orders/domain";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { PaymentServiceError, prepareOrderForEditing } from "@/lib/payments/service";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export type PaymentEditRouteDependencies = {
  isAllowedMutation(request: Request): boolean;
  actorFromHeaders(headers: Headers): Promise<OrderActor | null>;
  prepare(actor: OrderActor, orderNumber: string): Promise<{ editable: true }>;
};

const defaults: PaymentEditRouteDependencies = {
  isAllowedMutation: isAllowedOrderMutation,
  actorFromHeaders: orderActorFromHeaders,
  prepare: prepareOrderForEditing,
};

export async function handlePaymentEditPost(request: Request, context: RouteContext, dependencies = defaults) {
  if (!dependencies.isAllowedMutation(request)) return Response.json({ error: "Origine refusée." }, { status: 403 });
  const actor = await dependencies.actorFromHeaders(request.headers).catch(() => null);
  if (!actor) return Response.json({ error: "Authentification requise." }, { status: 401 });
  try {
    const { orderNumber } = await context.params;
    return Response.json(await dependencies.prepare(actor, orderNumber), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "La commande ne peut pas encore être modifiée." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import { parseOrderDraftInput } from "@/lib/orders/domain";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import {
  deleteDraftOrder,
  enforceOrderRateLimit,
  getOrderForActor,
  saveDraftOrder,
} from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function GET(request: Request, context: RouteContext) {
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  const { orderNumber } = await context.params;
  const order = await getOrderForActor(actor, orderNumber);
  return order ? orderJson({ order }) : orderJson({ error: "Commande introuvable." }, 404);
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  try {
    const { orderNumber } = await context.params;
    await enforceOrderRateLimit(actor.id, "draft");
    const parsed = parseOrderDraftInput(await readOrderJson(request));
    if (!parsed.ok) return orderJson({ error: parsed.message, field: parsed.field }, 400);
    return orderJson({ order: await saveDraftOrder(actor, orderNumber, parsed.value) });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  try {
    const { orderNumber } = await context.params;
    await enforceOrderRateLimit(actor.id, "delete");
    await deleteDraftOrder(actor, orderNumber);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

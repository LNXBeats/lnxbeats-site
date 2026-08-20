import { parseOrderDraftInput } from "@/lib/orders/domain";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import { enforceOrderRateLimit, finalizeOrder } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  try {
    const { orderNumber } = await context.params;
    await enforceOrderRateLimit(actor.id, "finalize");
    const body = await readOrderJson(request);
    const parsed = parseOrderDraftInput(body);
    if (!parsed.ok) return orderJson({ error: parsed.message, field: parsed.field }, 400);
    const personalUseTermsAccepted = Boolean(body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).personalUseTermsAccepted === true);
    return orderJson({ order: await finalizeOrder(actor, orderNumber, parsed.value, personalUseTermsAccepted) });
  } catch (error) {
    return orderErrorResponse(error);
  }
}

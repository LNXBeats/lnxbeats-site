import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { enforceOrderRateLimit, requestCommercialLicense } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);

  try {
    await enforceOrderRateLimit(actor.id, "rights");
    const { orderNumber } = await context.params;
    return orderJson({ order: await requestCommercialLicense(actor, orderNumber) }, 201);
  } catch (error) {
    return orderErrorResponse(error);
  }
}

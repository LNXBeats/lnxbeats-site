import { parseOrderDraftInput } from "@/lib/orders/domain";
import { orderErrorResponse, orderJson } from "@/lib/orders/http";
import { isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import { createDraftOrder, enforceOrderRateLimit } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrderMutation(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Connectez-vous avec un compte vérifié pour enregistrer ce brief." }, 401);

  try {
    await enforceOrderRateLimit(actor.id, "draft");
    const parsed = parseOrderDraftInput(await readOrderJson(request));
    if (!parsed.ok) return orderJson({ error: parsed.message, field: parsed.field }, 400);
    return orderJson({ order: await createDraftOrder(actor, parsed.value) }, 201);
  } catch (error) {
    return orderErrorResponse(error);
  }
}

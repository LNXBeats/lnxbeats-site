import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { parseRightsDraftInput } from "@/lib/rights/input";
import { readRightsJson, rightsRequestDependencies } from "@/lib/rights/request";
import { createRightsDraft } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!rightsRequestDependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await rightsRequestDependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  try {
    await enforceOrderRateLimit(actor.id, "rights");
    const { orderNumber } = await context.params;
    const input = parseRightsDraftInput(await readRightsJson(request));
    return orderJson({ request: await createRightsDraft(actor, orderNumber, input) }, 201);
  } catch (error) {
    return rightsErrorResponse(error);
  }
}

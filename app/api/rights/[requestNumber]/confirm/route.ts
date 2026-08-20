import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { rightsRequestDependencies } from "@/lib/rights/request";
import { confirmRightsCoordinates } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ requestNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!rightsRequestDependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await rightsRequestDependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  try {
    await enforceOrderRateLimit(actor.id, "rights");
    const { requestNumber } = await context.params;
    return orderJson({ request: await confirmRightsCoordinates(actor, requestNumber) });
  } catch (error) {
    return rightsErrorResponse(error);
  }
}

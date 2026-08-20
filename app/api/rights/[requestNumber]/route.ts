import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { rightsRequestDependencies } from "@/lib/rights/request";
import { cancelRightsRequest, deleteRightsDraft } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actorForMutation(request: Request) {
  if (!rightsRequestDependencies.isAllowed(request)) return { response: orderJson({ error: "Origine refusée." }, 403) } as const;
  const actor = await rightsRequestDependencies.actor(request.headers);
  if (!actor) return { response: orderJson({ error: "Authentification requise." }, 401) } as const;
  await enforceOrderRateLimit(actor.id, "rights");
  return { actor } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ requestNumber: string }> }) {
  try {
    const context = await actorForMutation(request);
    if ("response" in context) return context.response;
    const { requestNumber } = await params;
    await cancelRightsRequest(context.actor, requestNumber);
    return orderJson({ cancelled: true });
  } catch (error) { return rightsErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ requestNumber: string }> }) {
  try {
    const context = await actorForMutation(request);
    if ("response" in context) return context.response;
    const { requestNumber } = await params;
    await deleteRightsDraft(context.actor, requestNumber);
    return orderJson({ deleted: true });
  } catch (error) { return rightsErrorResponse(error); }
}

import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { rightsRequestDependencies } from "@/lib/rights/request";
import { generatePartnershipPreauthorizationRevision } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ requestNumber: string }> };

const revisionRouteQueues = new Map<string, Promise<void>>();

async function withPartnershipRevisionRouteLock<T>(requestNumber: string, operation: () => Promise<T>) {
  const previous = revisionRouteQueues.get(requestNumber) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  revisionRouteQueues.set(requestNumber, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (revisionRouteQueues.get(requestNumber) === tail) revisionRouteQueues.delete(requestNumber);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!rightsRequestDependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const { requestNumber } = await context.params;
  return withPartnershipRevisionRouteLock(requestNumber, async () => {
    const actor = await rightsRequestDependencies.actor(request.headers);
    if (!actor) return orderJson({ error: "Authentification requise." }, 401);
    try {
      await enforceOrderRateLimit(actor.id, "rights");
      return orderJson({ request: await generatePartnershipPreauthorizationRevision(actor, requestNumber) });
    } catch (error) {
      return rightsErrorResponse(error);
    }
  });
}

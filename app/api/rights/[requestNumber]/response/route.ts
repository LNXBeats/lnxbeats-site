import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { readRightsJson, rightsRequestDependencies } from "@/lib/rights/request";
import { respondRightsInformation } from "@/lib/rights/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ requestNumber: string }> }) {
  if (!rightsRequestDependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await rightsRequestDependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  try {
    await enforceOrderRateLimit(actor.id, "rights");
    const body = await readRightsJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "message")) return orderJson({ error: "Le formulaire est invalide." }, 400);
    const { requestNumber } = await params;
    await respondRightsInformation(actor, requestNumber, (body as { message?: unknown }).message);
    return orderJson({ completed: true });
  } catch (error) { return rightsErrorResponse(error); }
}

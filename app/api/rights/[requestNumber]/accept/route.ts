import { orderJson } from "@/lib/orders/http";
import { enforceOrderRateLimit } from "@/lib/orders/service";
import { rightsErrorResponse } from "@/lib/rights/http";
import { readRightsJson, rightsRequestDependencies } from "@/lib/rights/request";
import { acceptanceRequestProof, acceptRightsContract } from "@/lib/rights/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ requestNumber: string }> }) {
  if (!rightsRequestDependencies.isAllowed(request)) return orderJson({ error: "Origine refusée." }, 403);
  const actor = await rightsRequestDependencies.actor(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  try {
    await enforceOrderRateLimit(actor.id, "rights");
    const body = await readRightsJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["typedFullName", "password", "accepted"].includes(key))) return orderJson({ error: "Le formulaire est invalide." }, 400);
    const input = body as { typedFullName?: unknown; password?: unknown; accepted?: unknown };
    const { requestNumber } = await params;
    const proof = acceptanceRequestProof(request.headers.get("cookie") ?? "", request.headers.get("user-agent"));
    await acceptRightsContract(actor, requestNumber, { typedFullName: input.typedFullName, password: input.password, accepted: input.accepted, ...proof });
    return orderJson({ completed: true });
  } catch (error) { return rightsErrorResponse(error); }
}

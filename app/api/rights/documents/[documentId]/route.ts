import { orderDeliveryResponse } from "@/lib/orders/audio-response";
import { orderJson } from "@/lib/orders/http";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { getContractDocumentForActor, recordContractDocumentViewed } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

async function serve(request: Request, context: RouteContext, head = false) {
  const actor = await orderActorFromHeaders(request.headers);
  if (!actor) return orderJson({ error: "Authentification requise." }, 401);
  const { documentId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    return orderJson({ error: "Document introuvable." }, 404);
  }
  const document = await getContractDocumentForActor(actor, documentId);
  if (!document) return orderJson({ error: "Document introuvable." }, 404);
  const download = new URL(request.url).searchParams.get("telecharger") === "1";
  const response = await orderDeliveryResponse(request, document.asset, { head, download });
  // A byte range or HEAD request proves access, not that the complete document
  // was displayed. Only a successful full-body response unlocks acceptance.
  if (!head && response.status === 200 && !request.headers.has("range")) await recordContractDocumentViewed(actor, documentId);
  return response;
}

export function GET(request: Request, context: RouteContext) {
  return serve(request, context);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

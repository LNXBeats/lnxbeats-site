import { handleOrderDeliveryDownload } from "@/lib/orders/delivery-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderNumber: string; assetId: string }> };

async function serve(request: Request, context: RouteContext, head = false) {
  const { orderNumber, assetId } = await context.params;
  const download = new URL(request.url).searchParams.get("lecture") !== "1";
  return handleOrderDeliveryDownload(request, { orderNumber, assetId, head, download });
}

export function GET(request: Request, context: RouteContext) {
  return serve(request, context);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

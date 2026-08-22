import { handleAdminDeliveryDelete } from "@/lib/orders/delivery-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderNumber: string; assetId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const { orderNumber, assetId } = await context.params;
  return handleAdminDeliveryDelete(request, { orderNumber, assetId });
}

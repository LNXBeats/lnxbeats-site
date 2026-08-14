import { handleAdminDeliveryUpload } from "@/lib/orders/delivery-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ orderNumber: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { orderNumber } = await context.params;
  return handleAdminDeliveryUpload(request, orderNumber);
}

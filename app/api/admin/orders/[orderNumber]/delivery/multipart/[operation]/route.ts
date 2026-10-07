import { handleDeliveryDirectUpload } from "@/lib/orders/delivery-direct-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ orderNumber: string; operation: string }> };
export async function POST(request: Request, context: Context) {
  const { orderNumber, operation } = await context.params;
  return handleDeliveryDirectUpload(request, orderNumber, operation);
}

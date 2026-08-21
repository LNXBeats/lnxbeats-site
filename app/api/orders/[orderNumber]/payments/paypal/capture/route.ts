import { handlePaypalCapturePost } from "@/lib/payments/paypal-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export function POST(request: Request, context: RouteContext) {
  return handlePaypalCapturePost(request, context);
}

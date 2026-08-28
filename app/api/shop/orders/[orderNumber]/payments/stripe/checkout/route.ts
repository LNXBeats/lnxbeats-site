import { handleShopStripeCheckoutPost } from "@/lib/shop/payment-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export function POST(request: Request, context: RouteContext) {
  return handleShopStripeCheckoutPost(request, context);
}

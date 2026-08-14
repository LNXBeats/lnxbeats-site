import { handleStripeCheckoutPost } from "@/lib/payments/checkout-route-handler";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderNumber: string }> };

export function POST(request: Request, context: RouteContext) {
  return handleStripeCheckoutPost(request, context);
}

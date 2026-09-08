import { handleRightsStripeCheckout } from "@/lib/rights/payment-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ requestNumber: string }> };
export function POST(request: Request, context: Context) { return handleRightsStripeCheckout(request, context); }

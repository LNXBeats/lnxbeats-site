import { handleStripeWebhookPost } from "@/lib/payments/webhook-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleStripeWebhookPost(request);
}

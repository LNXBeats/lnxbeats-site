import { after } from "next/server";

import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { handleStripeWebhookPost } from "@/lib/payments/webhook-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleStripeWebhookPost(request);
  if (response.ok) {
    after(async () => {
      await dispatchPendingOrderNotifications().catch(() => undefined);
    });
  }
  return response;
}

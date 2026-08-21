import { handleResendWebhookPost } from "@/lib/notifications/resend-webhook-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleResendWebhookPost(request);
}

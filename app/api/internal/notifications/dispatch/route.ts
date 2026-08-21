import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let configuration;
  try {
    configuration = parseNotificationConfiguration();
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!notificationWorkerAuthorized(request.headers.get("authorization"), configuration.workerSecret)) {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const result = await dispatchPendingOrderNotifications(25);
  return Response.json({ ok: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

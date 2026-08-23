import "server-only";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";
import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";

export type NotificationDispatchRouteDependencies = Readonly<{
  dispatch(limit: number): Promise<{ claimed: number; delivered: number; failed: number; skipped: number }>;
}>;

const dependencies: NotificationDispatchRouteDependencies = { dispatch: dispatchPendingOrderNotifications };

export async function handleNotificationDispatchPost(
  request: Request,
  injected: NotificationDispatchRouteDependencies = dependencies,
) {
  if (!notificationWorkerAuthorized(request.headers.get("authorization"), process.env.NOTIFICATION_WORKER_SECRET?.trim() || null)) {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  let configuration;
  try {
    configuration = parseNotificationConfiguration();
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!configuration.emailEnabled || !configuration.workerEnabled) {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const result = await injected.dispatch(25);
  return Response.json({ ok: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

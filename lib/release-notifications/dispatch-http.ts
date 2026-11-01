import "server-only";
import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";
import { releaseAlertDispatchActivation } from "@/lib/release-notifications/activation";
import { dispatchReleaseAlerts } from "@/lib/release-notifications/dispatch";

type Dependencies = { dispatch: typeof dispatchReleaseAlerts };

/** Release-only capability: no caller-selected recipient, date, limit or transaction dispatch. */
export async function handleReleaseAlertDispatchPost(request: Request,
  dependencies: Dependencies = { dispatch: dispatchReleaseAlerts },
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const headers = { "Cache-Control": "no-store" };
  const secret = environment.NOTIFICATION_WORKER_SECRET?.trim() || null;
  if (!secret || secret.length < 32 || !notificationWorkerAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  try {
    const configuration = parseNotificationConfiguration(environment);
    if (request.headers.get("x-notification-environment") !== configuration.deploymentEnvironment
      || !releaseAlertDispatchActivation(configuration, environment, new Date())) {
      return Response.json({ ok: false }, { status: 503, headers });
    }
    const result = await dependencies.dispatch(25, undefined, configuration, undefined, environment);
    return Response.json({ ok: true, ...result }, { headers });
  } catch {
    // Never disclose provider payloads, database details, recipients or credentials.
    return Response.json({ ok: false }, { status: 503, headers });
  }
}

import { releaseAlertUnsubscribeUser } from "@/lib/release-notifications/token";
import { unsubscribeReleaseAlerts } from "@/lib/release-notifications/preferences";
import { handleReleaseAlertUnsubscribe } from "@/lib/release-notifications/http";
export const dynamic = "force-dynamic";
// GET is intentionally read-only: email scanners must not unsubscribe a person.
export const POST = (request: Request) => handleReleaseAlertUnsubscribe(request, { verify: releaseAlertUnsubscribeUser, unsubscribe: unsubscribeReleaseAlerts });

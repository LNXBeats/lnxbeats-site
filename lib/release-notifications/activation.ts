import type { NotificationConfiguration } from "@/lib/notifications/config";

type Environment = Readonly<Record<string, string | undefined>>;

/** Explicit UTC watermark, never inferred from deploy/start time or an old queue. */
export function releaseAlertActivationAt(environment: Environment): Date | null {
  const value = environment.RELEASE_ALERT_ACTIVATED_AT;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) return null;
  return date;
}

export function releaseAlertDispatchActivation(configuration: NotificationConfiguration, environment: Environment, now: Date) {
  const activationAt = releaseAlertActivationAt(environment);
  return environment.RELEASE_ALERT_EMAIL_ENABLED === "true" && activationAt && activationAt <= now
    && configuration.emailEnabled && configuration.workerEnabled && configuration.canonicalUrl
    && (environment.AUTH_SECRET?.length ?? 0) >= 32 ? activationAt : null;
}

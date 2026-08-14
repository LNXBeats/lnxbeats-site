import "server-only";

export type NotificationChannelAvailability = Readonly<{
  email: "ENABLED" | "DISABLED";
  sms: "READY_FOR_PROVIDER";
}>;

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  throw new Error("Notification configuration is invalid.");
}

export function notificationChannelAvailability(
  environment: Record<string, string | undefined> = process.env,
): NotificationChannelAvailability {
  return {
    email: enabled(environment.ORDER_NOTIFICATION_EMAIL_ENABLED, true) ? "ENABLED" : "DISABLED",
    // No SMS provider is configured in V0.7.1. The abstraction deliberately
    // exposes readiness without pretending that a message can be delivered.
    sms: "READY_FOR_PROVIDER",
  };
}

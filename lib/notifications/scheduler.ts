import "server-only";

import { NOTIFICATION_SCHEDULER_MODE, parseNotificationConfiguration } from "@/lib/notifications/config";
import { dispatchPendingOrderNotifications } from "@/lib/notifications/service";

export const NOTIFICATION_SCHEDULER_BATCH_SIZE = 25;
export type NotificationSchedulerResult = Readonly<{
  exitCode: 0 | 1;
  outcome: "completed" | "disabled" | "failed";
  environment: "development" | "staging" | "production" | "invalid";
  claimed: number;
  delivered: number;
  failed: number;
  skipped: number;
  durationMs: number;
}>;

type DispatchResult = Readonly<{
  claimed: number;
  delivered: number;
  failed: number;
  skipped: number;
}>;

type SchedulerLog = Readonly<Record<string, string | number | boolean>>;

export type NotificationSchedulerDependencies = Readonly<{
  dispatch(limit: number): Promise<DispatchResult>;
  now(): number;
  info(entry: SchedulerLog): void;
  error(entry: SchedulerLog): void;
}>;

const defaultDependencies: NotificationSchedulerDependencies = {
  dispatch: dispatchPendingOrderNotifications,
  now: Date.now,
  info: (entry) => console.info(JSON.stringify(entry)),
  error: (entry) => console.error(JSON.stringify(entry)),
};

function schedulerEnvironment(environment: Record<string, string | undefined>) {
  const value = environment.NOTIFICATION_DEPLOYMENT_ENV?.trim().toLowerCase();
  return value === "development" || value === "staging" || value === "production" ? value : "invalid";
}

function schedulerMode(environment: Record<string, string | undefined>) {
  const value = environment.NOTIFICATION_SCHEDULER_MODE?.trim().toLowerCase() || "disabled";
  if (value === "disabled" || value === NOTIFICATION_SCHEDULER_MODE) return value;
  throw new Error("Notification scheduler mode is invalid.");
}

function tickResult(
  input: Omit<NotificationSchedulerResult, "durationMs">,
  startedAt: number,
  now: () => number,
): NotificationSchedulerResult {
  return { ...input, durationMs: Math.max(0, now() - startedAt) };
}

export async function runNotificationSchedulerTick(
  environment: Record<string, string | undefined> = process.env,
  dependencies: NotificationSchedulerDependencies = defaultDependencies,
): Promise<NotificationSchedulerResult> {
  const startedAt = dependencies.now();
  const environmentName = schedulerEnvironment(environment);
  dependencies.info({
    event: "notification.scheduler.started",
    environment: environmentName,
    batchLimit: NOTIFICATION_SCHEDULER_BATCH_SIZE,
  });

  let stage: "configuration" | "dispatch" = "configuration";
  try {
    const mode = schedulerMode(environment);
    const configuration = parseNotificationConfiguration(environment);
    if (mode === "disabled") {
      if (configuration.workerEnabled) throw new Error("The notification scheduler is disabled while the worker is enabled.");
      const result = tickResult({
        exitCode: 0,
        outcome: "disabled",
        environment: environmentName,
        claimed: 0,
        delivered: 0,
        failed: 0,
        skipped: 0,
      }, startedAt, dependencies.now);
      dependencies.info({ event: "notification.scheduler.completed", ...result });
      return result;
    }
    if (environmentName !== "staging" && environmentName !== "production") {
      throw new Error("The notification scheduler requires an explicit staging or production environment.");
    }
    if (!configuration.workerEnabled) {
      const result = tickResult({
        exitCode: 0,
        outcome: "disabled",
        environment: environmentName,
        claimed: 0,
        delivered: 0,
        failed: 0,
        skipped: 0,
      }, startedAt, dependencies.now);
      dependencies.info({ event: "notification.scheduler.completed", ...result });
      return result;
    }
    if (!configuration.emailEnabled) throw new Error("The notification scheduler requires email notifications to be enabled.");

    stage = "dispatch";
    const dispatch = await dependencies.dispatch(NOTIFICATION_SCHEDULER_BATCH_SIZE);
    const result = tickResult({
      exitCode: 0,
      outcome: "completed",
      environment: environmentName,
      ...dispatch,
    }, startedAt, dependencies.now);
    dependencies.info({ event: "notification.scheduler.completed", ...result });
    return result;
  } catch {
    const result = tickResult({
      exitCode: 1,
      outcome: "failed",
      environment: environmentName,
      claimed: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
    }, startedAt, dependencies.now);
    dependencies.error({
      event: "notification.scheduler.failed",
      environment: environmentName,
      stage,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    return result;
  }
}

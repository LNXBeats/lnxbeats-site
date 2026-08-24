import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NOTIFICATION_SCHEDULER_BATCH_SIZE,
  runNotificationSchedulerTick,
  type NotificationSchedulerDependencies,
} from "@/lib/notifications/scheduler";
import {
  evaluateNotificationSchedulerDatabase,
  evaluateNotificationSchedulerEnvironment,
} from "@/lib/notifications/scheduler-preflight";

const secret = "scheduler-secret-that-is-never-logged-0001";
const stagingEnvironment = {
  NODE_ENV: "production",
  NOTIFICATION_DEPLOYMENT_ENV: "staging",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_WORKER_SECRET: secret,
  NOTIFICATION_SCHEDULER_MODE: "railway-cron",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
} satisfies Record<string, string>;

function harness(dispatch: NotificationSchedulerDependencies["dispatch"]) {
  const info: Array<Record<string, string | number | boolean>> = [];
  const error: Array<Record<string, string | number | boolean>> = [];
  let now = 1_000;
  const dependencies: NotificationSchedulerDependencies = {
    dispatch,
    now: () => { now += 5; return now; },
    info: (entry) => info.push({ ...entry }),
    error: (entry) => error.push({ ...entry }),
  };
  return { dependencies, info, error };
}

test("un tick armé exécute exactement un lot borné et accepte les échecs individuels", async () => {
  let observedLimit = 0;
  const current = harness(async (limit) => {
    observedLimit = limit;
    return { claimed: 3, delivered: 2, failed: 1, skipped: 4 };
  });
  const result = await runNotificationSchedulerTick(stagingEnvironment, current.dependencies);
  assert.equal(observedLimit, NOTIFICATION_SCHEDULER_BATCH_SIZE);
  assert.deepEqual(result, {
    exitCode: 0,
    outcome: "completed",
    environment: "staging",
    claimed: 3,
    delivered: 2,
    failed: 1,
    skipped: 4,
    durationMs: 5,
  });
  assert.deepEqual(current.info.map((entry) => entry.event), [
    "notification.scheduler.started",
    "notification.scheduler.completed",
  ]);
  assert.deepEqual(current.error, []);
});

test("worker désactivé termine en no-op sans réclamer ni contacter un provider", async () => {
  let calls = 0;
  const current = harness(async () => {
    calls += 1;
    return { claimed: 1, delivered: 1, failed: 0, skipped: 0 };
  });
  const result = await runNotificationSchedulerTick({
    ...stagingEnvironment,
    NOTIFICATION_WORKER_ENABLED: "false",
    EMAIL_NOTIFICATIONS_ENABLED: "false",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "disabled",
  }, current.dependencies);
  assert.deepEqual(result, {
    exitCode: 0,
    outcome: "disabled",
    environment: "staging",
    claimed: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    durationMs: 5,
  });
  assert.equal(calls, 0);
});

test("le premier tick Production désarmé quitte à zéro sans dispatch ni provider", async () => {
  let calls = 0;
  const current = harness(async () => {
    calls += 1;
    return { claimed: 1, delivered: 1, failed: 0, skipped: 0 };
  });
  const result = await runNotificationSchedulerTick({
    NODE_ENV: "production",
    NOTIFICATION_DEPLOYMENT_ENV: "production",
    NOTIFICATION_EMAIL_TRANSPORT: "disabled",
    EMAIL_NOTIFICATIONS_ENABLED: "false",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_WORKER_ENABLED: "false",
    NOTIFICATION_SCHEDULER_MODE: "disabled",
    SMS_TRANSPORT: "disabled",
    SMS_NOTIFICATIONS_ENABLED: "false",
  }, current.dependencies);
  assert.deepEqual(result, {
    exitCode: 0,
    outcome: "disabled",
    environment: "production",
    claimed: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    durationMs: 5,
  });
  assert.equal(calls, 0);
});

test("scheduler désactivé par défaut reste fail-closed et refuse un worker armé", async () => {
  let calls = 0;
  const current = harness(async () => {
    calls += 1;
    return { claimed: 0, delivered: 0, failed: 0, skipped: 0 };
  });
  const disabled = await runNotificationSchedulerTick({
    ...stagingEnvironment,
    NOTIFICATION_SCHEDULER_MODE: "disabled",
    NOTIFICATION_WORKER_ENABLED: "false",
  }, current.dependencies);
  const inconsistent = await runNotificationSchedulerTick({
    ...stagingEnvironment,
    NOTIFICATION_SCHEDULER_MODE: "disabled",
  }, current.dependencies);
  assert.equal(disabled.outcome, "disabled");
  assert.equal(disabled.exitCode, 0);
  assert.equal(inconsistent.outcome, "failed");
  assert.equal(inconsistent.exitCode, 1);
  assert.equal(calls, 0);
});

test("mauvais environnement, mode, secret ou transport échouent avant dispatch", async () => {
  const mutations = [
    { ...stagingEnvironment, NOTIFICATION_DEPLOYMENT_ENV: "development" },
    { ...stagingEnvironment, NOTIFICATION_SCHEDULER_MODE: "other" },
    { ...stagingEnvironment, NOTIFICATION_WORKER_SECRET: "short" },
    {
      ...stagingEnvironment,
      NOTIFICATION_EMAIL_TRANSPORT: "disabled",
      EMAIL_NOTIFICATIONS_ENABLED: "false",
      OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
      CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    },
  ];
  for (const environment of mutations) {
    let calls = 0;
    const current = harness(async () => {
      calls += 1;
      return { claimed: 0, delivered: 0, failed: 0, skipped: 0 };
    });
    const result = await runNotificationSchedulerTick(environment, current.dependencies);
    assert.equal(result.exitCode, 1);
    assert.equal(result.outcome, "failed");
    assert.equal(calls, 0);
  }
});

test("une panne d'infrastructure retourne non-zero et les logs restent assainis", async () => {
  const privateValues = `${secret} owner@example.com re_private payload-private`;
  const current = harness(async () => { throw new Error(privateValues); });
  const result = await runNotificationSchedulerTick(stagingEnvironment, current.dependencies);
  assert.equal(result.exitCode, 1);
  assert.equal(result.outcome, "failed");
  const serialized = JSON.stringify([...current.info, ...current.error]);
  assert.match(serialized, /notification\.scheduler\.failed/);
  assert.doesNotMatch(serialized, /scheduler-secret|owner@example|re_private|payload-private/);
});

test("le preflight scheduler exige un environnement explicite et l'armement complet", () => {
  const passing = evaluateNotificationSchedulerEnvironment(stagingEnvironment);
  assert.deepEqual(passing.filter((rule) => !rule.passed), []);

  const missingMode = evaluateNotificationSchedulerEnvironment({
    ...stagingEnvironment,
    NOTIFICATION_SCHEDULER_MODE: "disabled",
  });
  assert.equal(missingMode.find((rule) => rule.name === "scheduler.mode.railwayCron")?.passed, false);

  const wrongEnvironment = evaluateNotificationSchedulerEnvironment({
    ...stagingEnvironment,
    NOTIFICATION_DEPLOYMENT_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
  });
  assert.equal(wrongEnvironment.find((rule) => rule.name === "scheduler.configuration.valid")?.passed, false);
});

test("le preflight PostgreSQL est read-only et rapporte l'outbox sans réclamer", async () => {
  const observedCounts: unknown[] = [];
  const database = {
    $queryRaw: async () => [{ tables_ready: true, indexes_ready: true }],
    orderNotification: {
      count: async (input: unknown) => { observedCounts.push(input); return observedCounts.length; },
    },
    notificationEvent: {
      count: async (input: unknown) => { observedCounts.push(input); return 4; },
    },
  } as unknown as NonNullable<Parameters<typeof evaluateNotificationSchedulerDatabase>[1]>;
  const result = await evaluateNotificationSchedulerDatabase("staging", database);
  assert.deepEqual(result.rules.filter((rule) => !rule.passed), []);
  assert.deepEqual(result.metrics, {
    pending: 1,
    retryable: 2,
    expiredLeases: 3,
    requiresReview: 4,
    foreignEnvironment: 5,
  });
  assert.equal(observedCounts.length, 5);
  assert.equal("update" in (database.orderNotification as object), false);
});

test("la configuration Railway racine ne force aucun déploiement sur les services partagés", async () => {
  const [rootConfiguration, schedulerConfiguration, packageSource, schedulerSource, healthRoute] = await Promise.all([
    readFile("railway.toml", "utf8"),
    readFile("railway.scheduler.toml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/notifications-scheduler.ts", "utf8"),
    readFile("app/api/health/route.ts", "utf8"),
  ]);

  assert.match(rootConfiguration, /\[build\]\s+builder = "RAILPACK"/);
  assert.doesNotMatch(rootConfiguration, /\[deploy\]|startCommand|healthcheck|cronSchedule|preDeployCommand|restartPolicy/i);

  const packageConfiguration = JSON.parse(packageSource) as { scripts: Record<string, string> };
  assert.equal(packageConfiguration.scripts.start, "next start");
  assert.equal(
    packageConfiguration.scripts["notifications:scheduler:run"],
    "NODE_OPTIONS=--conditions=react-server node --env-file-if-exists=.env.local --import tsx scripts/notifications-scheduler.ts",
  );
  assert.match(healthRoute, /export async function GET\(\)/);

  assert.match(schedulerConfiguration, /startCommand = "npm run notifications:scheduler:run"/);
  assert.match(schedulerConfiguration, /cronSchedule = "\*\/15 \* \* \* \*"/);
  assert.match(schedulerConfiguration, /restartPolicyType = "NEVER"/);
  assert.doesNotMatch(schedulerConfiguration, /healthcheck|npm start|notifications:dispatch|curl|Authorization/i);

  assert.equal(schedulerSource.match(/runNotificationSchedulerTick\(\)/g)?.length, 1);
  assert.match(schedulerSource, /try\s*\{[\s\S]*runNotificationSchedulerTick\(\)[\s\S]*\}\s*finally\s*\{\s*await prisma\.\$disconnect\(\);\s*\}/);
  assert.doesNotMatch(schedulerSource, /setInterval|setTimeout|while\s*\(|for\s*\(\s*;;/);
});

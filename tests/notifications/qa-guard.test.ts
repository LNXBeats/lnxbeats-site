import assert from "node:assert/strict";
import test from "node:test";

import { assertNotificationQaEnvironment, NOTIFICATION_QA_CONFIRMATION, NOTIFICATION_QA_TARGET } from "@/lib/notifications/qa-guard";

const connection = "postgresql://qa:qa@127.0.0.1:51254/template1";
const environment = {
  NOTIFICATION_QA_CONFIRM: NOTIFICATION_QA_CONFIRMATION,
  NODE_ENV: "test",
  LNX_DATABASE_TARGET: NOTIFICATION_QA_TARGET,
  DATABASE_URL: connection,
  AUTH_URL: "http://localhost:31730",
  NOTIFICATION_DEPLOYMENT_ENV: "development",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
};
const proof = { name: NOTIFICATION_QA_TARGET, pid: process.pid, exports: { database: { connectionString: connection } } };

test("la garde accepte uniquement la cible notification jetable exacte", () => {
  assert.equal(assertNotificationQaEnvironment(environment, proof).baseUrl, "http://localhost:31730");
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, LNX_DATABASE_TARGET: "lnx-studio-local-preview" }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, DATABASE_URL: connection.replace("51254", "51238") }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, AUTH_URL: "http://localhost:3000" }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, NOTIFICATION_EMAIL_TRANSPORT: "resend" }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false" }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, EMAIL_OWNER_RECIPIENT: "owner@example.invalid" }, proof));
  assert.throws(() => assertNotificationQaEnvironment({ ...environment, SMS_NOTIFICATIONS_ENABLED: "true" }, proof));
  const dynamicConnection = connection.replace("51254", "51226");
  assert.equal(assertNotificationQaEnvironment(
    { ...environment, DATABASE_URL: dynamicConnection, NOTIFICATION_QA_DATABASE_PORT: "51226" },
    { ...proof, exports: { database: { connectionString: dynamicConnection } } },
  ).databaseUrl.includes(":51226/"), true);
  assert.throws(() => assertNotificationQaEnvironment(
    { ...environment, DATABASE_URL: dynamicConnection, NOTIFICATION_QA_DATABASE_PORT: "5432" },
    { ...proof, exports: { database: { connectionString: dynamicConnection } } },
  ));
});

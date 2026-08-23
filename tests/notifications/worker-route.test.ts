import assert from "node:assert/strict";
import test from "node:test";

import { handleNotificationDispatchPost } from "@/lib/notifications/dispatch-route-handler";

const saved = { ...process.env };
const secret = "w".repeat(32);

function configure(workerEnabled: boolean) {
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "development";
  process.env.NOTIFICATION_DEPLOYMENT_ENV = "development";
  process.env.NOTIFICATION_EMAIL_TRANSPORT = "capture";
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.OWNER_EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED = "true";
  process.env.NOTIFICATION_WORKER_ENABLED = String(workerEnabled);
  process.env.NOTIFICATION_WORKER_SECRET = secret;
  process.env.APP_CANONICAL_URL = "http://localhost:31780";
}

function request(authorization: string | null) {
  return new Request("http://localhost:31780/api/internal/notifications/dispatch", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

test.afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

test("la route worker refuse avant dispatch un Bearer absent ou incorrect", async () => {
  configure(true);
  let calls = 0;
  const dependencies = { dispatch: async () => { calls += 1; return { claimed: 0, delivered: 0, failed: 0, skipped: 0 }; } };
  assert.equal((await handleNotificationDispatchPost(request(null), dependencies)).status, 401);
  assert.equal((await handleNotificationDispatchPost(request("Bearer wrong"), dependencies)).status, 401);
  assert.equal(calls, 0);
});

test("la route worker reste fermée lorsque le flag est désactivé", async () => {
  configure(false);
  let calls = 0;
  const response = await handleNotificationDispatchPost(request(`Bearer ${secret}`), {
    dispatch: async () => { calls += 1; return { claimed: 0, delivered: 0, failed: 0, skipped: 0 }; },
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("la route worker armée transmet un lot borné et retourne le résultat", async () => {
  configure(true);
  let observedLimit = 0;
  const response = await handleNotificationDispatchPost(request(`Bearer ${secret}`), {
    dispatch: async (limit) => {
      observedLimit = limit;
      return { claimed: 2, delivered: 1, failed: 1, skipped: 0 };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(observedLimit, 25);
  assert.deepEqual(await response.json(), { ok: true, claimed: 2, delivered: 1, failed: 1, skipped: 0 });
});

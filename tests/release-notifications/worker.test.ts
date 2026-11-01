import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { handleReleaseAlertDispatchPost } from "@/lib/release-notifications/dispatch-http";
import { dispatchReleaseAlertsViaWeb } from "@/lib/release-notifications/worker";

const environment = {
  NOTIFICATION_DEPLOYMENT_ENV: "development", NOTIFICATION_EMAIL_TRANSPORT: "capture",
  NOTIFICATION_WORKER_ENABLED: "true", NOTIFICATION_WORKER_SECRET: "synthetic-shared-worker-secret-at-least-32",
  APP_CANONICAL_URL: "http://127.0.0.1:3165", RELEASE_ALERT_EMAIL_ENABLED: "true",
  RELEASE_ALERT_ACTIVATED_AT: "2000-01-01T00:00:00.000Z", AUTH_SECRET: "synthetic-web-only-unsubscribe-secret-32",
};
const counts = { claimed: 2, delivered: 1, failed: 1, skipped: 0 };
function request(authorization: string | null = `Bearer ${environment.NOTIFICATION_WORKER_SECRET}`, target = "development") {
  return new Request(`${environment.APP_CANONICAL_URL}/api/internal/notifications/releases/dispatch`, {
    method: "POST", headers: { ...(authorization ? { authorization } : {}), "x-notification-environment": target },
  });
}

test("release-only endpoint authorizes before touching dispatch and fails closed on disabled/invalid activation", async () => {
  let calls = 0;
  const dependencies = { dispatch: async () => { calls++; return counts; } };
  for (const authorization of [null, "Bearer wrong"]) {
    assert.equal((await handleReleaseAlertDispatchPost(request(authorization), dependencies, environment)).status, 401);
  }
  for (const changes of [{ RELEASE_ALERT_EMAIL_ENABLED: "false" }, { RELEASE_ALERT_ACTIVATED_AT: undefined },
    { AUTH_SECRET: undefined }, { NOTIFICATION_WORKER_ENABLED: "false" }]) {
    assert.equal((await handleReleaseAlertDispatchPost(request(), dependencies, { ...environment, ...changes })).status, 503);
  }
  assert.equal((await handleReleaseAlertDispatchPost(request(undefined, "production"), dependencies, environment)).status, 503);
  assert.equal(calls, 0);
});

test("authorized release-only endpoint fixes its limit and returns only counters without transactional dispatch", async () => {
  let observed = 0;
  const response = await handleReleaseAlertDispatchPost(request(), { dispatch: async limit => { observed = limit ?? 0; return counts; } }, environment);
  assert.equal(response.status, 200); assert.equal(observed, 25);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, ...counts });
  const source = await readFile("lib/release-notifications/dispatch-http.ts", "utf8");
  assert.doesNotMatch(source, /combined-dispatch|dispatchPendingNotifications|dispatchSupportNotifications|dispatchPendingOrderNotifications/);
  const failed = await handleReleaseAlertDispatchPost(request(), { dispatch: async () => { throw new Error("private-recipient private-secret"); } }, environment);
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false });
});

test("remote release dispatch defaults closed without fetch, then uses only the fixed Web route and worker secret", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, options) => {
    calls++;
    assert.equal(input, `${environment.APP_CANONICAL_URL}/api/internal/notifications/releases/dispatch`);
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${environment.NOTIFICATION_WORKER_SECRET}`);
    assert.equal(new Headers(options?.headers).get("x-notification-environment"), "development");
    assert.doesNotMatch(JSON.stringify(options), /synthetic-web-only/);
    assert.equal(options?.body, undefined);
    return Response.json({ ok: true, ...counts });
  };
  assert.deepEqual(await dispatchReleaseAlertsViaWeb({}, fetcher), { claimed: 0, delivered: 0, failed: 0, skipped: 0 });
  assert.equal(calls, 0);
  const { AUTH_SECRET: _unused, RELEASE_ALERT_EMAIL_ENABLED: _disabled, ...workerEnvironment } = environment;
  assert.deepEqual(await dispatchReleaseAlertsViaWeb({ ...workerEnvironment, RELEASE_ALERT_WEB_DISPATCH_ENABLED: "true" }, fetcher), counts);
  assert.equal(calls, 1);
});

test("remote release dispatch rejects redirect/errors/malformed counters with no retry or sensitive error", async () => {
  for (const result of [new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
    Response.json({ ok: false }, { status: 503 }), Response.json({ ok: true, ...counts, claimed: 26 }),
    Response.json({ ok: true, ...counts, delivered: -1 })]) {
    let calls = 0;
    await assert.rejects(dispatchReleaseAlertsViaWeb({ ...environment, RELEASE_ALERT_WEB_DISPATCH_ENABLED: "true" }, async () => { calls++; return result; }),
      { message: "RELEASE_ALERT_WEB_DISPATCH_UNAVAILABLE" });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(dispatchReleaseAlertsViaWeb({ ...environment, RELEASE_ALERT_WEB_DISPATCH_ENABLED: "true" }, async () => {
    calls++; throw new Error("secret and recipient must not escape");
  }), { message: "RELEASE_ALERT_WEB_DISPATCH_UNAVAILABLE" });
  assert.equal(calls, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { handleReleaseAlertGet, handleReleaseAlertPatch, handleReleaseAlertUnsubscribe, type ReleaseAlertHttpDependencies } from "@/lib/release-notifications/http";
import { DEFAULT_RELEASE_ALERT_CHOICES } from "@/lib/release-notifications/domain";
import { releaseAlertUnsubscribeToken, releaseAlertUnsubscribeUser } from "@/lib/release-notifications/token";

const baseUrl = "http://127.0.0.1:3165";
function fixture() {
  const saved: unknown[] = [];
  const user = { id: "own-session-user", status: "ACTIVE", emailVerified: true };
  const dependencies: ReleaseAlertHttpDependencies = { baseUrl, user: async () => user,
    get: async id => { assert.equal(id, user.id); return DEFAULT_RELEASE_ALERT_CHOICES; },
    save: async (id, choices) => { saved.push({ id, choices }); return choices; } };
  return { saved, user, dependencies };
}
function request(body: unknown = DEFAULT_RELEASE_ALERT_CHOICES, origin = baseUrl) {
  return new Request(`${baseUrl}/api/account/release-alerts`, { method: "PATCH", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
test("preferences reject cross-origin mutations before consulting session", async () => {
  const f = fixture(); f.dependencies.user = async () => { throw new Error("MUST_NOT_LOOK_UP"); };
  assert.equal((await handleReleaseAlertPatch(request(undefined, "https://attacker.invalid"), f.dependencies)).status, 403);
  assert.equal(f.saved.length, 0);
});
test("anonymous, suspended and unverified accounts cannot read or update marketing preferences", async () => {
  for (const identity of [null, { id: "x", status: "SUSPENDED", emailVerified: true }, { id: "x", status: "ACTIVE", emailVerified: false }]) {
    const f = fixture(); f.dependencies.user = async () => identity;
    assert.equal((await handleReleaseAlertGet(f.dependencies)).status, 401);
    assert.equal((await handleReleaseAlertPatch(request(), f.dependencies)).status, 401); assert.equal(f.saved.length, 0);
  }
});
test("only the session owner can change preferences; spoofed user IDs and untyped consent are rejected", async () => {
  const f = fixture();
  assert.equal((await handleReleaseAlertPatch(request({ ...DEFAULT_RELEASE_ALERT_CHOICES, userId: "another-user" }), f.dependencies)).status, 400);
  assert.equal((await handleReleaseAlertPatch(request({ ...DEFAULT_RELEASE_ALERT_CHOICES, music: "true" }), f.dependencies)).status, 400);
  assert.equal(f.saved.length, 0);
  assert.equal((await handleReleaseAlertPatch(request({ ...DEFAULT_RELEASE_ALERT_CHOICES, music: true }), f.dependencies)).status, 200);
  assert.deepEqual(f.saved, [{ id: "own-session-user", choices: { ...DEFAULT_RELEASE_ALERT_CHOICES, music: true } }]);
});
test("all-false withdrawal remains available, read is private/no-store, malformed and oversized bodies fail safely", async () => {
  const f = fixture();
  const response = await handleReleaseAlertGet(f.dependencies);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await handleReleaseAlertPatch(request(), f.dependencies)).status, 200);
  assert.equal((await handleReleaseAlertPatch(request({ ...DEFAULT_RELEASE_ALERT_CHOICES, extra: "x".repeat(5000) }), f.dependencies)).status, 400);
  assert.equal((await handleReleaseAlertPatch(new Request(`${baseUrl}/api/account/release-alerts`, { method: "PATCH", headers: { origin: baseUrl, "Content-Type": "application/json" }, body: "{" }), f.dependencies)).status, 400);
});
test("valid one-click withdrawal needs no session; invalid tokens never reach the database", async () => {
  const id = "3dfde946-d72b-465b-b53c-a7878cac9d37", secret = "synthetic-unsubscribe-secret-at-least-32";
  const token = releaseAlertUnsubscribeToken(id, secret), removed: string[] = [];
  const dependencies = { verify: (value: unknown) => releaseAlertUnsubscribeUser(value, secret), unsubscribe: async (userId: string) => { removed.push(userId); } };
  const response = await handleReleaseAlertUnsubscribe(new Request(`${baseUrl}/api/release-alerts/unsubscribe?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), dependencies);
  assert.equal(response.status, 200); assert.deepEqual(removed, [id]);
  const invalid = await handleReleaseAlertUnsubscribe(new Request(`${baseUrl}/api/release-alerts/unsubscribe`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "forged" }) }), dependencies);
  assert.equal(invalid.status, 400); assert.equal(removed.length, 1);
});
test("a valid unsubscribe with database failure returns retryable 503 without any secret or infrastructure detail", async () => {
  const response = await handleReleaseAlertUnsubscribe(new Request(`${baseUrl}/api/release-alerts/unsubscribe`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "valid-synthetic-token" }) }), {
    verify: () => "verified-user", unsubscribe: async () => { throw new Error("postgres password synthetic-secret-must-not-leak"); },
  });
  assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.deepEqual(await response.json(), { ok: false });
});

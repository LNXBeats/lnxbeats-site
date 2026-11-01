import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@/generated/prisma/client";
import { dispatchReleaseAlerts, type ReleaseAlertMessage } from "@/lib/release-notifications/dispatch";
import { parseNotificationConfiguration } from "@/lib/notifications/config";

const environment = { RELEASE_ALERT_EMAIL_ENABLED: "true", RELEASE_ALERT_ACTIVATED_AT: "2000-01-01T00:00:00.000Z", AUTH_SECRET: "synthetic-secret-used-only-for-unit-tests-32", NOTIFICATION_DEPLOYMENT_ENV: "development", NOTIFICATION_EMAIL_TRANSPORT: "capture", NOTIFICATION_WORKER_ENABLED: "true", NOTIFICATION_WORKER_SECRET: "synthetic-worker-secret-at-least-32", APP_CANONICAL_URL: "http://127.0.0.1:3165" };
const configuration = parseNotificationConfiguration(environment);
function fixture(options: { active?: boolean; verified?: boolean; music?: boolean; lateConsent?: boolean; suppressed?: boolean; public?: boolean; emailChanged?: boolean; expiredRetry?: boolean; withdrawAfterClaim?: boolean; baselineAfterClaim?: boolean } = {}) {
  const pubTime = new Date(Date.now() - 60_000), before = new Date(pubTime.getTime() - 60_000);
  const preference = { music: options.music ?? true, shop: false, editorial: false, musicConsentedAt: options.lateConsent ? new Date() : before, shopConsentedAt: null, editorialConsentedAt: null, locale: "fr" };
  const user = { id: "3dfde946-d72b-465b-b53c-a7878cac9d37", email: options.emailChanged ? "changed@example.test" : "member@example.test", status: options.active === false ? "SUSPENDED" : "ACTIVE", emailVerified: options.verified ?? true, releaseAlertPreference: preference };
  const publication = { id: "synthetic-publication", kind: "MUSIC", resourceId: "synthetic-project", title: "Titre original", path: "/album/titre-original", baseline: false, createdAt: pubTime };
  const row = { id: "synthetic-delivery", userId: user.id, recipient: "member@example.test", publicationId: publication.id, deploymentEnvironment: "development", status: "PENDING", attempts: options.expiredRetry ? 1 : 0, firstAttemptAt: options.expiredRetry ? new Date(Date.now() - 13 * 3600_000) : null, leaseUntil: null, leaseToken: null, availableAt: before, publication, user } as Record<string, unknown> & { status: string };
  let suppressed = options.suppressed ?? false, publicVisible = options.public ?? true;
  const calls: ReleaseAlertMessage[] = [];
  const tx = {
    $queryRaw: async () => [],
    releasePublication: { findMany: async () => [], findUnique: async () => ({ ...publication, baseline: options.baselineAfterClaim ?? publication.baseline }) },
    releaseAlertDelivery: { findMany: async () => ["PENDING", "FAILED_RETRYABLE", "PROCESSING"].includes(row.status) ? [{ id: row.id }] : [], findUniqueOrThrow: async () => row,
      update: async ({ data }: { data: { status?: string } }) => { Object.assign(row, data); if (options.withdrawAfterClaim && data.status === "PROCESSING") preference.music = false; return row; }, updateMany: async ({ where, data }: { where: { leaseToken: string }; data: object }) => {
        if (row.leaseToken !== where.leaseToken) return { count: 0 }; Object.assign(row, data); return { count: 1 };
      } },
    user: { findUnique: async () => user },
    project: { findUnique: async () => ({ title: "Titre original", slug: "titre-original", status: "PUBLISHED", publicVisible, type: "SINGLE" }) },
    notificationSuppression: { findUnique: async () => ({ active: suppressed }) },
    notificationEvent: { findMany: async () => [], update: async () => null },
  };
  const database = { ...tx, $transaction: async (operation: (db: typeof tx) => unknown) => operation(tx) } as unknown as PrismaClient;
  const send = async (message: ReleaseAlertMessage) => { calls.push(message); return "synthetic-provider-id"; };
  return { row, publication, user, preference, database, send, calls, suppress: () => { suppressed = true; }, hide: () => { publicVisible = false; } };
}
test("dedicated marketing switch defaults closed and does not touch database or provider", async () => {
  const result = await dispatchReleaseAlerts(25, async () => { throw new Error("MUST_NOT_SEND"); }, configuration, {} as PrismaClient, {});
  assert.deepEqual(result, { claimed: 0, delivered: 0, failed: 0, skipped: 0 });
});
test("activation watermark is mandatory, strict UTC and cannot be in the future", async () => {
  for (const value of [undefined, "", "not-a-date", "2026-02-30T00:00:00.000Z", "2000-01-01", "2000-01-01T00:00:00+00:00", "2999-01-01T00:00:00.000Z"]) {
    const result = await dispatchReleaseAlerts(25, async () => { throw new Error("MUST_NOT_SEND"); }, configuration,
      {} as PrismaClient, { ...environment, RELEASE_ALERT_ACTIVATED_AT: value });
    assert.equal(result.claimed, 0); assert.equal(result.delivered, 0);
  }
});
test("baseline, pre-activation, boundary, future and expired publications cannot send even from an existing delivery", async () => {
  for (const change of [
    { baseline: true }, { createdAt: new Date("1999-12-31T23:59:59.999Z") },
    { createdAt: new Date(environment.RELEASE_ALERT_ACTIVATED_AT) },
    { createdAt: new Date(Date.now() + 3600_000) }, { createdAt: new Date(Date.now() - 25 * 3600_000) },
  ]) {
    const f = fixture(); Object.assign(f.publication, change);
    await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
    assert.equal(f.calls.length, 0); assert.equal(f.row.status, "CANCELED");
  }
});
test("publication baseline is fetched again after the lease, immediately before sending", async () => {
  const f = fixture({ baselineAfterClaim: true });
  await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
  assert.equal(f.row.status, "CANCELED"); assert.equal(f.calls.length, 0);
});
test("fan-out filters prospectively, preserves old baseline markers, and requires consent before publication", async () => {
  const activationAt = new Date(Date.now() - 120_000), publicationAt = new Date(Date.now() - 60_000);
  const activeEnvironment = { ...environment, RELEASE_ALERT_ACTIVATED_AT: activationAt.toISOString() };
  const publications = [
    { id: "old", baseline: false, createdAt: new Date(activationAt.getTime() - 1) },
    { id: "baseline", baseline: true, createdAt: publicationAt },
    { id: "new", baseline: false, createdAt: publicationAt },
  ].map(row => ({ ...row, expanded: false, kind: "SHOP", resourceId: row.id, path: "/boutique/new-product", recipientCursor: null }));
  const updated: string[] = [], deliveries: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    releasePublication: {
      findMany: async ({ where }: { where: { baseline: boolean; createdAt: { gt: Date; lte: Date } } }) => {
        assert.equal(where.baseline, false); assert.deepEqual(where.createdAt.gt, activationAt);
        return publications; // Deliberately include ineligible rows to exercise the locked recheck.
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => publications.find(row => row.id === where.id),
      update: async ({ where }: { where: { id: string } }) => { updated.push(where.id); },
    },
    product: { findUnique: async () => ({ title: "New", slug: "new-product", status: "PUBLISHED" }) },
    releaseAlertPreference: { findMany: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.shop, true); assert.deepEqual(where.shopConsentedAt, { lt: publicationAt });
      assert.deepEqual(where.user, { status: "ACTIVE", emailVerified: true });
      return [{ userId: "member-id", user: { email: "member@example.test" } }];
    } },
    releaseAlertDelivery: {
      createMany: async ({ data, skipDuplicates }: { data: unknown[]; skipDuplicates: boolean }) => { assert.equal(skipDuplicates, true); deliveries.push(...data); },
      findMany: async ({ where }: { where: { publication: { baseline: boolean; createdAt: { gt: Date } } } }) => {
        assert.equal(where.publication.baseline, false); assert.deepEqual(where.publication.createdAt.gt, activationAt); return [];
      },
    },
  };
  const database = { ...tx, $transaction: async (operation: (db: typeof tx) => unknown) => operation(tx) } as unknown as PrismaClient;
  await dispatchReleaseAlerts(25, async () => { throw new Error("NO_SEND_DURING_FANOUT_TEST"); }, configuration, database, activeEnvironment);
  assert.deepEqual(updated, ["new"]); assert.equal(deliveries.length, 1);
  assert.equal((deliveries[0] as { publicationId: string }).publicationId, "new");
});
test("one eligible verified subscriber receives exactly one outbox delivery and a scoped unsubscribe link", async () => {
  const f = fixture();
  const first = await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
  const second = await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
  assert.equal(first.delivered, 1); assert.equal(second.delivered, 0); assert.equal(f.calls.length, 1); assert.equal(f.row.status, "SENT");
  assert.equal(f.calls[0].idempotencyKey, "release-alert:synthetic-delivery:v1");
  assert.match(f.calls[0].unsubscribeUrl, /\/desinscription\?token=/); assert.match(f.calls[0].oneClickUrl, /\/api\/release-alerts\/unsubscribe\?token=/);
});
test("opt-out, late opt-in, suspended/unverified users, changed email, hidden publication and suppression each cancel without sending", async () => {
  for (const options of [{ music: false }, { lateConsent: true }, { active: false }, { verified: false }, { emailChanged: true }, { public: false }, { suppressed: true }]) {
    const f = fixture(options); const result = await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
    assert.equal(result.delivered, 0); assert.equal(f.calls.length, 0); assert.equal(f.row.status, "CANCELED");
  }
});
test("expired provider idempotency window goes to review, never blind retry", async () => {
  const f = fixture({ expiredRetry: true });
  await dispatchReleaseAlerts(25, f.send, configuration, f.database, environment);
  assert.equal(f.row.status, "REQUIRES_REVIEW"); assert.equal(f.calls.length, 0);
});
test("ambiguous provider failure is retryable only with the same idempotency key and bounded attempts", async () => {
  const f = fixture(), keys: string[] = [];
  await dispatchReleaseAlerts(25, async message => { keys.push(message.idempotencyKey); throw new Error("synthetic timeout"); }, configuration, f.database, environment);
  assert.equal(f.row.status, "FAILED_RETRYABLE");
  f.row.availableAt = new Date(Date.now() - 1000);
  await dispatchReleaseAlerts(25, async message => { keys.push(message.idempotencyKey); return "same-provider-id"; }, configuration, f.database, environment);
  assert.equal(f.row.status, "SENT"); assert.equal(keys[0], keys[1]); assert.equal(keys.length, 2);
});
test("withdrawal after claim is rechecked immediately before sending, and active leases cannot be double-claimed", async () => {
  const withdrawn = fixture({ withdrawAfterClaim: true });
  await dispatchReleaseAlerts(25, withdrawn.send, configuration, withdrawn.database, environment);
  assert.equal(withdrawn.row.status, "CANCELED"); assert.equal(withdrawn.calls.length, 0);
  const leased = fixture(); leased.row.status = "PROCESSING"; leased.row.leaseUntil = new Date(Date.now() + 120_000);
  await dispatchReleaseAlerts(25, leased.send, configuration, leased.database, environment);
  assert.equal(leased.calls.length, 0); assert.equal(leased.row.status, "PROCESSING");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatLastSignIn, lastSignInObservation, successfulSignInReceipt } from "@/lib/auth/last-sign-in-policy";
import { recordSuccessfulSignIn } from "@/lib/auth/last-sign-in";

const userId = "78a6e0c8-b3b5-4ba6-970f-6fed7ca86f41";
const signedInAt = new Date("2026-10-22T16:30:00.000Z");
test("successful credential authentication produces a server-created session receipt only", () => {
  assert.deepEqual(successfulSignInReceipt({ userId, createdAt: signedInAt }, "/sign-in/email", signedInAt), { userId, signedInAt });
  for (const endpoint of [null, "/get-session", "/update-user", "/reset-password", "/verify-email"]) assert.equal(successfulSignInReceipt({ userId, createdAt: signedInAt }, endpoint, signedInAt), null);
  assert.equal(successfulSignInReceipt({ userId: "not-an-id", createdAt: signedInAt }, "/sign-in/email", signedInAt), null);
  assert.equal(successfulSignInReceipt({ userId, createdAt: "invalid" }, "/sign-in/email", signedInAt), null);
  assert.equal(successfulSignInReceipt({ userId, createdAt: new Date(signedInAt.getTime() + 120_000) }, "/sign-in/email", signedInAt), null);
});

test("recording is monotone, scoped to an active verified account, and stores only the login date", async () => {
  const writes: unknown[] = [];
  const db = { user: { async updateMany(input: unknown) { writes.push(input); return { count: 1 }; } } };
  assert.equal(await recordSuccessfulSignIn(db, { userId, createdAt: signedInAt }, "/sign-in/email", signedInAt), true);
  assert.deepEqual(writes, [{ where: { id: userId, status: "ACTIVE", emailVerified: true, OR: [{ lastSignedInAt: null }, { lastSignedInAt: { lt: signedInAt } }] }, data: { lastSignedInAt: signedInAt } }]);
  assert.equal(await recordSuccessfulSignIn(db, { userId, createdAt: signedInAt }, "/get-session", signedInAt), false);
  assert.equal(writes.length, 1);
});

test("late session hooks cannot move a newer recorded sign-in backwards", async () => {
  const db = { user: { async updateMany() { return { count: 0 }; } } };
  assert.equal(await recordSuccessfulSignIn(db, { userId, createdAt: signedInAt }, "/sign-in/email", signedInAt), false);
});

test("tracking failure does not break authentication or leak database/user details", async () => {
  const warnings: string[] = [];
  const db = { user: { async updateMany() { throw new Error("private@example.test token=not-for-logs"); } } };
  assert.equal(await recordSuccessfulSignIn(db, { userId, createdAt: signedInAt }, "/sign-in/email", signedInAt, code => warnings.push(code)), false);
  assert.deepEqual(warnings, ["LAST_SIGN_IN_RECORDING_UNAVAILABLE"]);
});

test("confirmed login survives deleted sessions and is not replaced by a newer unverified session", () => {
  assert.deepEqual(lastSignInObservation(signedInAt, null), { at: signedInAt, source: "CONFIRMED_SIGN_IN" });
  assert.deepEqual(lastSignInObservation(signedInAt, new Date("2026-10-23T00:00:00Z")), { at: signedInAt, source: "CONFIRMED_SIGN_IN" });
  assert.equal(lastSignInObservation(null, signedInAt).source, "RETAINED_SESSION");
  assert.equal(lastSignInObservation(null, null).source, "UNKNOWN");
  assert.equal(lastSignInObservation("invalid", "invalid").source, "UNKNOWN");
});

test("Paris dates follow daylight saving time and fallback is explicitly partial", () => {
  assert.equal(formatLastSignIn(lastSignInObservation(signedInAt, null), signedInAt).absolute, "22/10/2026 à 18:30:00 (Paris)");
  const winter = new Date("2026-12-22T16:30:00Z");
  assert.equal(formatLastSignIn(lastSignInObservation(winter, null), winter).absolute, "22/12/2026 à 17:30:00 (Paris)");
  assert.match(formatLastSignIn(lastSignInObservation(null, signedInAt), signedInAt).explanation, /historique partiel/);
  assert.match(formatLastSignIn(lastSignInObservation(null, null), signedInAt).explanation, /peut s’être connecté/);
  assert.equal(formatLastSignIn(lastSignInObservation(signedInAt, null), new Date(signedInAt.getTime() + 120_000)).relative, "il y a 2 minutes");
});

test("wiring records only session creation after authentication, never session updates or a client-writable field", async () => {
  const source = await readFile(new URL("../../lib/auth.ts", import.meta.url), "utf8");
  assert.match(source, /async after\(session, context\)\s*\{\s*await recordSuccessfulSignIn\(prisma, session, context\?\.path\)/);
  assert.equal(source.includes("lastSignedInAt:"), false);
  const migration = await readFile(new URL("../../prisma/migrations/20261022010000_member_last_signed_in/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN "lastSignedInAt" TIMESTAMPTZ\(3\)/);
  assert.equal(/\bUPDATE\s+"?users\b/i.test(migration), false);
  assert.equal(/DEFAULT\s+(?:now|CURRENT_TIMESTAMP)/i.test(migration), false);
});

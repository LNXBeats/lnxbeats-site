import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { finalMusicTermsCandidate, legalCandidates } from "../../data/legal";
import { earlyPerformanceConsentWording } from "../../data/order-offer";
import {
  earlyPerformanceConsentSnapshot,
  hasCurrentEarlyPerformanceConsent,
  resolveEarlyPerformanceConsent,
} from "../../lib/legal/early-performance-consent";

const absentProof = {
  earlyPerformanceConsentVersion: null,
  earlyPerformanceConsentHashSha256: null,
  earlyPerformanceConsentAcceptedAt: null,
};

test("early performance consent is distinct, explicit and tied to the current music candidate", () => {
  const snapshot = earlyPerformanceConsentSnapshot();
  assert.equal(snapshot.version, finalMusicTermsCandidate.version);
  assert.match(snapshot.hashSha256, /^[0-9a-f]{64}$/);
  assert.match(earlyPerformanceConsentWording, /Je demande expressément/);
  assert.match(earlyPerformanceConsentWording, /avant la fin du délai légal de rétractation de 14 jours/);
  assert.match(earlyPerformanceConsentWording, /une fois la prestation entièrement exécutée/);
  assert.equal(finalMusicTermsCandidate.status, "AWAITING_LEGAL_REVIEW");
  assert.equal(legalCandidates.length, 5);
});

test("missing and forged browser values fail closed", () => {
  const now = new Date("2026-09-01T20:00:00.000Z");
  assert.deepEqual(resolveEarlyPerformanceConsent(absentProof, undefined, now), {
    ok: false,
    reason: "EARLY_PERFORMANCE_CONSENT_REQUIRED",
  });
  assert.deepEqual(resolveEarlyPerformanceConsent(absentProof, "true", now), {
    ok: false,
    reason: "EARLY_PERFORMANCE_CONSENT_REQUIRED",
  });
  assert.deepEqual(resolveEarlyPerformanceConsent(absentProof, 1, now), {
    ok: false,
    reason: "EARLY_PERFORMANCE_CONSENT_REQUIRED",
  });
});

test("an explicit true creates a server-versioned auditable proof", () => {
  const now = new Date("2026-09-01T20:00:00.000Z");
  const result = resolveEarlyPerformanceConsent(absentProof, true, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.created, true);
  assert.equal(result.proof.earlyPerformanceConsentVersion, finalMusicTermsCandidate.version);
  assert.match(result.proof.earlyPerformanceConsentHashSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(result.proof.earlyPerformanceConsentAcceptedAt?.toISOString(), now.toISOString());
  assert.equal(hasCurrentEarlyPerformanceConsent(result.proof), true);
});

test("replay preserves a current proof and a candidate change requires fresh consent", () => {
  const acceptedAt = new Date("2026-09-01T20:00:00.000Z");
  const created = resolveEarlyPerformanceConsent(absentProof, true, acceptedAt);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const replay = resolveEarlyPerformanceConsent(created.proof, undefined, new Date("2026-09-01T20:05:00.000Z"));
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.created, false);
  assert.equal(replay.proof.earlyPerformanceConsentAcceptedAt, created.proof.earlyPerformanceConsentAcceptedAt);

  const stale = { ...created.proof, earlyPerformanceConsentVersion: "music-cgv-older-candidate" };
  assert.equal(hasCurrentEarlyPerformanceConsent(stale), false);
  assert.equal(resolveEarlyPerformanceConsent(stale, undefined, new Date()).ok, false);
  const renewed = resolveEarlyPerformanceConsent(stale, true, new Date("2026-09-01T21:00:00.000Z"));
  assert.equal(renewed.ok, true);
  if (renewed.ok) assert.equal(renewed.created, true);
});

test("Commander and payment preparation enforce the distinct proof", () => {
  const commander = readFileSync("components/music-order-form.tsx", "utf8");
  const route = readFileSync("app/api/orders/[orderNumber]/finalize/route.ts", "utf8");
  const orderService = readFileSync("lib/orders/service.ts", "utf8");
  const paymentService = readFileSync("lib/payments/service.ts", "utf8");
  const accountPage = readFileSync("app/compte/commandes/[orderNumber]/page.tsx", "utf8");
  const confirmationPage = readFileSync("app/commande/[orderNumber]/confirmation/page.tsx", "utf8");
  const adminPage = readFileSync("app/admin/commandes/[orderNumber]/page.tsx", "utf8");
  assert.match(commander, /useState\(false\).*earlyPerformanceConsentConfirmed|earlyPerformanceConsentConfirmed.*useState\(false\)/s);
  assert.match(commander, /id="order-early-performance-consent" type="checkbox"/);
  assert.doesNotMatch(commander, /defaultChecked/);
  assert.match(commander, /earlyPerformanceConsentAccepted: true/);
  assert.match(route, /earlyPerformanceConsentAccepted: \(body as Record<string, unknown>\)\.earlyPerformanceConsentAccepted/);
  assert.match(orderService, /resolveEarlyPerformanceConsent/);
  assert.match(paymentService, /hasCurrentEarlyPerformanceConsent/);
  assert.match(accountPage, /hasCurrentEarlyPerformanceConsent/);
  assert.match(confirmationPage, /hasCurrentEarlyPerformanceConsent/);
  assert.match(adminPage, /Preuve contractuelle/);
  assert.match(adminPage, /earlyPerformanceConsentHashSha256/);
});

test("the additive migration enforces a complete proof triple", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260901190000_order_early_performance_consent/migration.sql", "utf8");
  for (const field of [
    "earlyPerformanceConsentVersion",
    "earlyPerformanceConsentHashSha256",
    "earlyPerformanceConsentAcceptedAt",
  ]) {
    assert.match(schema, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /orders_early_performance_consent_complete/);
  assert.match(migration, /\^\[0-9a-f\]\{64\}\$/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)\b/i);
});

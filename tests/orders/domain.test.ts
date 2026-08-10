import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPhotoCapacity,
  calculateOrderPrice,
  canAccessOrder,
  canUseIncludedRevision,
  formatOrderNumber,
  parseOrderDraftInput,
  sanitizeOriginalFilename,
  validateOrderForSubmission,
} from "@/lib/orders/domain";

const validBrief = {
  title: "Un repère",
  recipient: "Camille",
  occasion: "Un anniversaire",
  brief: "Une histoire assez longue pour franchir la limite minimale.",
  musicalDirection: "Cinématographique",
  emotion: "Tendre",
  importantDetails: "",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  coverIncluded: false,
  priorityProcessing: false,
} as const;

test("calcule exclusivement la création personnelle entre 50 et 90 euros", () => {
  assert.deepEqual(calculateOrderPrice(validBrief), {
    usage: "PERSONAL",
    basePriceCents: 5_000,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 5_000,
    currency: "EUR",
    pricingVersion: "2026-08-v1",
    contractRequired: false,
  });
  assert.equal(calculateOrderPrice({ coverIncluded: true, priorityProcessing: false }).totalCents, 6_000);
  assert.equal(calculateOrderPrice({ coverIncluded: false, priorityProcessing: true }).totalCents, 8_000);
  assert.equal(calculateOrderPrice({ coverIncluded: true, priorityProcessing: true }).totalCents, 9_000);
});

test("ignore tout usage, montant, propriétaire ou rôle forgé par le client", () => {
  const parsed = parseOrderDraftInput({ ...validBrief, usage: "COMMERCIAL_EXTENDED", totalCents: 1, basePriceCents: -1, contractRequired: true, userId: "attacker", role: "ADMIN", status: "PAID" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal("usage" in parsed.value, false);
  assert.equal("totalCents" in parsed.value, false);
  assert.equal("userId" in parsed.value, false);
  assert.equal("role" in parsed.value, false);
  assert.equal(calculateOrderPrice(parsed.value).totalCents, 5_000);
});

test("refuse les payloads ambigus et les briefs incomplets", () => {
  assert.equal(parseOrderDraftInput([]).ok, false);
  assert.equal(parseOrderDraftInput({ ...validBrief, coverIncluded: "yes" }).ok, false);
  const parsed = parseOrderDraftInput({ ...validBrief, brief: "court" });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(validateOrderForSubmission(parsed.value).ok, false);
  assert.equal(parseOrderDraftInput({ ...validBrief, title: "x".repeat(121) }).ok, false);
  assert.equal(parseOrderDraftInput({ ...validBrief, brief: "x".repeat(10_001) }).ok, false);
});

test("formate une référence stable en UTC", () => {
  assert.equal(formatOrderNumber(42n, new Date("2031-12-31T23:59:59Z")), "LNX-2031-000042");
  assert.throws(() => formatOrderNumber(0), RangeError);
});

test("applique propriété, administration et retour inclus", () => {
  assert.equal(canAccessOrder({ id: "owner", role: "MEMBER" }, "owner"), true);
  assert.equal(canAccessOrder({ id: "other", role: "MEMBER" }, "owner"), false);
  assert.equal(canAccessOrder({ id: "admin", role: "ADMIN" }, "owner"), true);
  assert.equal(canUseIncludedRevision(1, 0), true);
  assert.equal(canUseIncludedRevision(1, 1), false);
});

test("borne les photos et neutralise les chemins de noms originaux", () => {
  assert.equal(assertPhotoCapacity(9, 1), true);
  assert.equal(assertPhotoCapacity(9, 2), false);
  assert.equal(assertPhotoCapacity(0, 0), false);
  assert.equal(sanitizeOriginalFilename("../../secret.jpg"), "secret.jpg");
  assert.equal(sanitizeOriginalFilename("..\\..\\portrait.png"), "portrait.png");
});

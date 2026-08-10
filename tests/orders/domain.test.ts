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
  usage: "PERSONAL",
  coverIncluded: false,
  priorityProcessing: false,
} as const;

test("calcule les prix personnels exclusivement en centimes", () => {
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
  assert.equal(calculateOrderPrice({ ...validBrief, coverIncluded: true, priorityProcessing: true }).totalCents, 9_000);
});

test("l'exploitation commerciale vaut 1 500 euros au total avant options et exige un contrat", () => {
  assert.equal(calculateOrderPrice({ usage: "COMMERCIAL_EXTENDED", coverIncluded: false, priorityProcessing: false }).totalCents, 150_000);
  const pricing = calculateOrderPrice({ usage: "COMMERCIAL_EXTENDED", coverIncluded: true, priorityProcessing: true });
  assert.equal(pricing.basePriceCents, 150_000);
  assert.equal(pricing.totalCents, 154_000);
  assert.equal(pricing.contractRequired, true);
});

test("ignore tout montant, propriétaire ou rôle forgé par le client", () => {
  const parsed = parseOrderDraftInput({ ...validBrief, totalCents: 1, basePriceCents: -1, contractRequired: false, userId: "attacker", role: "ADMIN", status: "PAID" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal("totalCents" in parsed.value, false);
  assert.equal("userId" in parsed.value, false);
  assert.equal("role" in parsed.value, false);
  assert.equal(calculateOrderPrice(parsed.value).totalCents, 5_000);
});

test("refuse les payloads ambigus et les briefs incomplets", () => {
  assert.equal(parseOrderDraftInput([]).ok, false);
  assert.equal(parseOrderDraftInput({ ...validBrief, usage: "FREE" }).ok, false);
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

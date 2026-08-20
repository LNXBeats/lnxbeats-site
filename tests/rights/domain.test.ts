import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRightsSplit,
  canCreateRightsRequest,
  canTransitionRightsRequest,
  formatRightsNumber,
  isLegalTemplateUsable,
  personalUseTermsSnapshot,
  retentionUntilForConcludedContract,
  rightsPaymentEnabled,
  rightsPriceSnapshot,
} from "@/lib/rights/domain";

test("rights prices are server-owned and rights payments remain disabled", () => {
  assert.equal(rightsPriceSnapshot("PUBLICATION_LICENSE").priceCents, 15_000);
  assert.equal(rightsPriceSnapshot("EXPLOITATION_PARTNERSHIP").priceCents, 150_000);
  assert.equal(rightsPriceSnapshot("PUBLICATION_LICENSE").currency, "EUR");
  assert.equal(rightsPaymentEnabled(), false);
});

test("a delivered order with a published master is required", () => {
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: [] }), true);
  assert.equal(canCreateRightsRequest({ orderStatus: "FINALIZING", hasPublishedDelivery: true, existingStatuses: [] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: false, existingStatuses: [] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: ["SUBMITTED"] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: ["REJECTED"] }), true);
});

test("workflow is explicit and cannot activate rights", () => {
  assert.equal(canTransitionRightsRequest("DRAFT", "SUBMITTED"), true);
  assert.equal(canTransitionRightsRequest("CONTRACT_READY", "CLIENT_ACCEPTED"), true);
  assert.equal(canTransitionRightsRequest("ADMIN_VALIDATED", "READY_FOR_PAYMENT"), true);
  assert.equal(canTransitionRightsRequest("READY_FOR_PAYMENT", "ACTIVE"), false);
  assert.equal(canTransitionRightsRequest("REJECTED", "SUBMITTED"), false);
});

test("70/30 is valid only as a deliberate proposal totaling 100", () => {
  assert.equal(assertRightsSplit(70, 30), true);
  assert.equal(assertRightsSplit(50, 40), false);
  assert.equal(assertRightsSplit(70.5, 29.5), false);
});

test("legal approval requires an admin and a timestamp", () => {
  assert.equal(isLegalTemplateUsable("DRAFT", null, null), false);
  assert.equal(isLegalTemplateUsable("APPROVED", new Date(), null), false);
  assert.equal(isLegalTemplateUsable("APPROVED", new Date(), "admin-id"), true);
});

test("numbering, terms hash, and ten-year retention are deterministic", () => {
  assert.equal(formatRightsNumber("PUBLICATION_LICENSE", 12, new Date("2026-08-20T10:00:00Z")), "LNX-LIC-2026-000012");
  assert.equal(formatRightsNumber("EXPLOITATION_PARTNERSHIP", 12, new Date("2026-08-20T10:00:00Z")), "LNX-PART-2026-000012");
  assert.match(personalUseTermsSnapshot().hashSha256, /^[a-f0-9]{64}$/);
  assert.equal(retentionUntilForConcludedContract(new Date("2026-08-20T10:00:00Z")).toISOString(), "2036-08-20T10:00:00.000Z");
});

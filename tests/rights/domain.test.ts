import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRightsSplit,
  canCreateRightsRequest,
  canGenerateContractDraft,
  canStartRightsReview,
  canTransitionRightsRequest,
  formatRightsNumber,
  isLegalTemplateUsable,
  personalUseTermsSnapshot,
  retentionUntilForConcludedContract,
  rightsPaymentEnabled,
  rightsPriceSnapshot,
  publicationLicenseEligibility,
} from "@/lib/rights/domain";

test("rights prices are server-owned and rights payments remain disabled", () => {
  assert.equal(rightsPriceSnapshot("PUBLICATION_LICENSE").priceCents, 15_000);
  assert.throws(() => rightsPriceSnapshot("EXPLOITATION_PARTNERSHIP"), /RIGHTS_OFFER_NOT_COMMERCIAL/);
  assert.equal(rightsPriceSnapshot("PUBLICATION_LICENSE").currency, "EUR");
  assert.equal(rightsPaymentEnabled(), false);
});

test("publication licensing is server-eligible only after paid final audio delivery", () => {
  const baseline = { ownerMatches: true, orderStatus: "DELIVERED", deliveredAt: new Date("2026-09-08T10:00:00Z"), expectedAmountCents: 5_000, expectedCurrency: "EUR", payments: [{ status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", refundedAmountCents: 0 }], deliveries: [{ assetType: "AUDIO", role: "DELIVERY" }], workTitle: "Œuvre livrée", existingStatuses: [] } as const;
  assert.equal(publicationLicenseEligibility(baseline).eligible, true);
  assert.ok(publicationLicenseEligibility({ ...baseline, orderStatus: "DRAFT" }).reasons.includes("ORDER_NOT_DELIVERED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, orderStatus: "AWAITING_PAYMENT", payments: [] }).reasons.includes("PAYMENT_NOT_CONFIRMED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, orderStatus: "IN_PROGRESS" }).reasons.includes("ORDER_NOT_DELIVERED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, deliveries: [] }).reasons.includes("FINAL_AUDIO_MISSING"));
  assert.ok(publicationLicenseEligibility({ ...baseline, deliveredAt: null }).reasons.includes("DELIVERY_DATE_MISSING"));
  assert.ok(publicationLicenseEligibility({ ...baseline, orderStatus: "CANCELLED" }).reasons.includes("ORDER_NOT_DELIVERED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, ownerMatches: false }).reasons.includes("NOT_OWNER"));
  assert.ok(publicationLicenseEligibility({ ...baseline, payments: [{ status: "REFUNDED", amountCents: 5_000, currency: "EUR", refundedAmountCents: 5_000 }] }).reasons.includes("PAYMENT_NOT_CONFIRMED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, payments: [{ status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", refundedAmountCents: 1_000 }] }).reasons.includes("PAYMENT_NOT_CONFIRMED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, payments: [{ status: "SUCCEEDED", amountCents: 4_999, currency: "EUR", refundedAmountCents: 0 }] }).reasons.includes("PAYMENT_NOT_CONFIRMED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, payments: [{ status: "SUCCEEDED", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 }] }).reasons.includes("PAYMENT_NOT_CONFIRMED"));
  assert.ok(publicationLicenseEligibility({ ...baseline, existingStatuses: ["ACTIVE"] }).reasons.includes("LICENSE_ALREADY_EXISTS"));
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

test("a contract draft requires review state and structured parameters", () => {
  assert.equal(canGenerateContractDraft("SUBMITTED", 1), false);
  assert.equal(canGenerateContractDraft("INFORMATION_REQUIRED", 1), false);
  assert.equal(canGenerateContractDraft("UNDER_REVIEW", 0), false);
  assert.equal(canGenerateContractDraft("UNDER_REVIEW", 1), true);
  assert.equal(canGenerateContractDraft("CONTRACT_PREPARATION", 1), true);
  assert.equal(canGenerateContractDraft("READY_FOR_PAYMENT", 1), false);
});

test("the Admin review action is hidden once contract preparation has started", () => {
  assert.equal(canStartRightsReview("SUBMITTED"), true);
  assert.equal(canStartRightsReview("PREAUTHORIZATION_GENERATED"), true);
  assert.equal(canStartRightsReview("UNDER_REVIEW"), false);
  assert.equal(canStartRightsReview("INFORMATION_REQUIRED"), false);
  assert.equal(canStartRightsReview("CONTRACT_PREPARATION"), false);
  assert.equal(canStartRightsReview("CONTRACT_READY"), false);
});

test("a commercial split accepts bounded integer totals of exactly 100 only", () => {
  assert.equal(assertRightsSplit(30, 70), true);
  assert.equal(assertRightsSplit(0, 100), true);
  assert.equal(assertRightsSplit(50, 50), true);
  assert.equal(assertRightsSplit(30, 60), false);
  assert.equal(assertRightsSplit(30, 80), false);
  assert.equal(assertRightsSplit(-10, 110), false);
  assert.equal(assertRightsSplit(101, -1), false);
  assert.equal(assertRightsSplit(Number.NaN, 100), false);
  assert.equal(assertRightsSplit(70.5, 29.5), false);
});

test("legal approval requires an admin and a timestamp", () => {
  assert.equal(isLegalTemplateUsable("DRAFT", null, null, null), false);
  assert.equal(isLegalTemplateUsable("APPROVED", new Date(), null, "LEGAL-2026-001"), false);
  assert.equal(isLegalTemplateUsable("APPROVED", new Date(), "admin-id", null), false);
  assert.equal(isLegalTemplateUsable("APPROVED", new Date(), "admin-id", "LEGAL-2026-001"), true);
});

test("numbering, terms hash, and ten-year retention are deterministic", () => {
  assert.equal(formatRightsNumber("PUBLICATION_LICENSE", 12, new Date("2026-08-20T10:00:00Z")), "LNX-LIC-2026-000012");
  assert.equal(formatRightsNumber("EXPLOITATION_PARTNERSHIP", 12, new Date("2026-08-20T10:00:00Z")), "LNX-PART-2026-000012");
  assert.match(personalUseTermsSnapshot().hashSha256, /^[a-f0-9]{64}$/);
  assert.equal(retentionUntilForConcludedContract(new Date("2026-08-20T10:00:00Z")).toISOString(), "2036-08-20T10:00:00.000Z");
});

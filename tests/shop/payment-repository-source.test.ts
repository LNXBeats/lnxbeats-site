import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a delayed same-provider review closes only an uncaptured active retry before taking the review slot", async () => {
  const source = await readFile(
    new URL("../../lib/shop/payment-repository.ts", import.meta.url),
    "utf8",
  );
  const review = source.match(/async function recordReview[\s\S]*?\n\}/)?.[0] ?? "";
  const closeSiblingAt = review.indexOf("transaction.payment.updateMany");
  const updateReviewedPaymentAt = review.indexOf("transaction.payment.update({");

  assert.ok(closeSiblingAt >= 0);
  assert.ok(updateReviewedPaymentAt > closeSiblingAt);
  assert.match(review, /shopOrderId: input\.shopOrderId/);
  assert.match(review, /provider: input\.event\.provider/);
  assert.match(review, /id: \{ not: input\.paymentId \}/);
  assert.match(review, /status: \{ in: \["CREATED", "PENDING", "REQUIRES_REVIEW"\] \}/);
  assert.match(review, /paidAt: null/);
  assert.match(review, /status: "CANCELED"/);
  assert.match(review, /failureCode: "SHOP_PAYMENT_SUPERSEDED_BY_REVIEW"/);
  assert.match(review, /status: "REQUIRES_REVIEW"[\s\S]*paidAt: \{ not: null \}/);
  assert.match(review, /capturedSiblingAlreadyUnderReview/);
});

test("review persistence keeps non-conflicting captured provider evidence", async () => {
  const source = await readFile(
    new URL("../../lib/shop/payment-repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /providerCheckoutBelongsToAnother/);
  assert.match(source, /providerPaymentBelongsToAnother/);
  assert.match(source, /persistProviderPaymentId: !providerPaymentBelongsToAnother/);
  assert.match(source, /!payment\.providerPaymentId \|\| payment\.providerPaymentId === event\.providerPaymentId/);
  assert.match(source, /persistPaymentMethod: !payment\.paymentMethod/);
  assert.doesNotMatch(source, /persistProviderIdentifiers: false/);
});

test("Shop payment transactions load ShopOrder relations sequentially", async () => {
  const source = await readFile(
    new URL("../../lib/shop/payment-repository.ts", import.meta.url),
    "utf8",
  );
  const loader = source.match(/async function shopOrderWithItems[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(loader, /runSequentialDatabaseQueries\(/);
  assert.match(loader, /transaction\.shopOrderItem\.findMany/);
  assert.match(loader, /transaction\.stockReservation\.findMany/);
  assert.equal(source.match(/shopOrderWithItems\(transaction,/g)?.length, 3);
  assert.doesNotMatch(
    source,
    /transaction\.shopOrder\.findUniqueOrThrow\([\s\S]{0,500}include:\s*\{\s*items:/,
  );
});

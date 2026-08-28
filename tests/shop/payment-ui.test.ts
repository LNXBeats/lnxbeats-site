import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canResumeShopPaypalCapture,
  shopOrderPaymentState,
  shopReservationIsActive,
} from "@/lib/shop/order-presentation";

test("Shop payment reuses the premium shell with a non-prechecked legal acceptance", async () => {
  const [shell, stripe, paypal, page] = await Promise.all([
    readFile(new URL("../../components/payment-checkout-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/stripe-checkout-action.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/paypal-checkout-action.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /target = "music"/);
  assert.match(shell, /useState\(false\)/);
  assert.match(shell, /J’ai lu et j’accepte les/);
  assert.match(shell, /href="\/cgv\/boutique"/);
  assert.match(page, /target="shop"/);
  assert.match(page, /shopPaymentProvidersAvailable/);
  assert.match(stripe, /\/api\/shop\/orders\/\$\{encodeURIComponent\(orderNumber\)\}\/payments\/stripe\/checkout/);
  assert.match(paypal, /\/api\/shop\/orders\/\$\{encodeURIComponent\(orderNumber\)\}\/payments\/paypal\/checkout/);
  assert.match(`${stripe}\n${paypal}`, /JSON\.stringify\(\{ termsAccepted: true \}\)/);
  assert.doesNotMatch(`${stripe}\n${paypal}`, /termsVersion/);
});

test("the member account sequences music, rights, and Shop reads on the shared database client", async () => {
  const account = await readFile(
    new URL("../../app/compte/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(account, /runSequentialDatabaseQueries\(/);
  assert.match(account, /\(\) => listMemberOrders\(actor\)/);
  assert.match(account, /\(\) => listRightsRequestsForActor\(actor\)/);
  assert.match(account, /\(\) => listMemberShopOrders\(session\.user\.id\)/);
  assert.match(account, /\(\) => listMemberWithdrawalRequests\(session\.user\.id\)/);
  assert.doesNotMatch(account, /Promise\.all\(\[\s*listMemberOrders\(actor\)/);
});

test("Shop return paths remain informational and target the private purchase page", async () => {
  const [notice, capture, page] = await Promise.all([
    readFile(new URL("../../components/payment-return-notice.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/paypal-return-capture.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(notice, /Le retour sur le site ne suffit pas à confirmer le paiement/);
  assert.match(notice, /\/compte\/achats/);
  assert.match(capture, /\/api\/shop\/orders/);
  assert.match(page, /shopOrderPaymentState\(order\)/);
  assert.match(page, /PaymentReturnNotice/);
});

test("a persisted PayPal return remains capturable after Checkout flags close", async () => {
  const payments = [{
    provider: "PAYPAL",
    providerCheckoutId: "PAYPAL-SHOP-ORDER-1",
    status: "PENDING",
  }];
  assert.equal(canResumeShopPaypalCapture(payments, "PAYPAL-SHOP-ORDER-1"), true);
  assert.equal(canResumeShopPaypalCapture([], "PAYPAL-SHOP-ORDER-1"), false);
  assert.equal(canResumeShopPaypalCapture(payments, "PAYPAL-OTHER-ORDER"), false);
  assert.equal(canResumeShopPaypalCapture(
    [{ ...payments[0], status: "REQUIRES_REVIEW" }],
    "PAYPAL-SHOP-ORDER-1",
  ), false);

  const page = await readFile(
    new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /canResumeShopPaypalCapture\(order\.payments, query\.token\)/);
  assert.doesNotMatch(page, /paymentReturn === "paypal-retour" && query\.token && providers\.paypal/);
});

test("a paid ShopOrder under financial review remains review-first for the member", () => {
  assert.equal(shopOrderPaymentState({
    paymentStatus: "PAID",
    paymentReviewAt: new Date("2026-08-27T22:00:00.000Z"),
    payments: [{ status: "SUCCEEDED" }, { status: "REQUIRES_REVIEW" }],
  }), "review");
});

test("Shop Checkout remains closed after the persisted stock reservation expires", () => {
  const now = new Date("2026-08-27T22:00:00.000Z");
  assert.equal(shopReservationIsActive(new Date("2026-08-27T22:00:01.000Z"), now), true);
  assert.equal(shopReservationIsActive(new Date("2026-08-27T22:00:00.000Z"), now), false);
  assert.equal(shopReservationIsActive(new Date("2026-08-27T21:59:59.000Z"), now), false);
});

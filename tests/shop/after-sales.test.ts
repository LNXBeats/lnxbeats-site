import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertTransition,
  calculateShopReturnRefund,
  parseMemberShopReturnForm,
  ShopAfterSalesError,
  SHOP_RETURN_REQUEST_CONFIRMATION,
} from "@/lib/shop/after-sales-domain";
import {
  shopAfterSalesQaEnabled,
  SHOP_AFTER_SALES_QA_CONFIRMATION,
  SHOP_AFTER_SALES_QA_ORIGIN,
  SHOP_AFTER_SALES_QA_TARGET,
} from "@/lib/shop/after-sales-config";
import { hasCompatibleShopRefundSourceInvoice } from "@/lib/shop/refund-accounting-safety";
import {
  shopReturnAuditActionLabel,
  shopReturnCostDecisionLabel,
  shopReturnRefundStatusLabel,
  shopReturnStatusLabel,
  shopReturnTypeLabel,
} from "@/lib/shop/after-sales-presentation";

const productId = "11111111-1111-4111-8111-111111111111";

function validEnvironment() {
  return {
    NODE_ENV: "test",
    SHOP_AFTER_SALES_ENABLED: "true",
    SHOP_AFTER_SALES_QA_CONFIRM: SHOP_AFTER_SALES_QA_CONFIRMATION,
    SHOP_AFTER_SALES_REFUND_PROVIDER: "fake",
    AUTH_URL: SHOP_AFTER_SALES_QA_ORIGIN,
    SITE_URL: SHOP_AFTER_SALES_QA_ORIGIN,
    LNX_DATABASE_TARGET: SHOP_AFTER_SALES_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_AFTER_SALES_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:55432/template1?schema=public",
    PAYMENTS_ENABLED: "false",
    SHOP_PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    EMAIL_PROVIDER: "capture",
  } as NodeJS.ProcessEnv;
}

function cloneFormData(source: FormData) {
  const copy = new FormData();
  for (const [name, value] of source.entries()) copy.append(name, value);
  return copy;
}

test("Phase 5B QA is fail-closed and impossible on Railway, a remote DB, or a real provider", () => {
  assert.equal(shopAfterSalesQaEnabled(validEnvironment()), true);
  for (const mutation of [
    { SHOP_AFTER_SALES_ENABLED: "yes" },
    { SHOP_AFTER_SALES_QA_CONFIRM: "wrong" },
    { SHOP_AFTER_SALES_REFUND_PROVIDER: "stripe" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { DATABASE_URL: "postgresql://db.example.invalid:55432/template1" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { RAILWAY_ENVIRONMENT: "production" },
    { STRIPE_SECRET_KEY: "present" },
    { PAYPAL_CLIENT_SECRET: "present" },
    { RESEND_API_KEY: "present" },
    { SHOP_PAYMENTS_ENABLED: "true" },
  ]) assert.equal(shopAfterSalesQaEnabled({ ...validEnvironment(), ...mutation }), false);
});

test("member return form accepts only exact owned line identities and explicit confirmation", () => {
  const form = new FormData();
  form.set("orderNumber", "LNX-SHOP-2026-000002");
  form.set("type", "DEFECTIVE");
  form.set("comment", "Défaut QA observé.");
  form.set(`quantity:${productId}`, "2");
  form.set("confirmation", SHOP_RETURN_REQUEST_CONFIRMATION);
  const parsed = parseMemberShopReturnForm(form);
  assert.equal(parsed.quantities.get(productId), 2);
  assert.equal(parsed.type, "DEFECTIVE");

  const forged = cloneFormData(form);
  forged.set("amountCents", "1");
  assert.throws(() => parseMemberShopReturnForm(forged), ShopAfterSalesError);
  const unconfirmed = cloneFormData(form);
  unconfirmed.delete("confirmation");
  assert.throws(() => parseMemberShopReturnForm(unconfirmed), ShopAfterSalesError);
});

test("refund amount is derived exclusively from immutable unit snapshots and explicit shipping choice", () => {
  assert.deepEqual(calculateShopReturnRefund({
    lines: [{ unitPriceCents: 2_500, refundableQuantity: 2 }, { unitPriceCents: 3_000, refundableQuantity: 1 }],
    shippingCents: 800,
    shippingDecision: "NONE",
  }), { itemsRefundCents: 8_000, shippingRefundCents: 0, totalRefundCents: 8_000 });
  assert.equal(calculateShopReturnRefund({
    lines: [{ unitPriceCents: 2_500, refundableQuantity: 1 }], shippingCents: 800, shippingDecision: "FULL",
  }).totalRefundCents, 3_300);
  assert.throws(() => calculateShopReturnRefund({ lines: [], shippingCents: 800, shippingDecision: "NONE" }), ShopAfterSalesError);
});

test("Shop refunds accept only the immutable invoice linked to the winning payment and order", () => {
  const payment = {
    id: "11111111-1111-4111-8111-111111111112",
    shopOrderId: "11111111-1111-4111-8111-111111111113",
    currency: "EUR",
    amountCents: 7_549,
    invoice: {
      id: "11111111-1111-4111-8111-111111111114",
      paymentId: "11111111-1111-4111-8111-111111111112",
      shopOrderId: "11111111-1111-4111-8111-111111111113",
      currency: "EUR",
      totalCents: 7_549,
    },
  };
  assert.equal(hasCompatibleShopRefundSourceInvoice(payment, payment.shopOrderId), true);
  assert.equal(hasCompatibleShopRefundSourceInvoice({ ...payment, invoice: null }, payment.shopOrderId), false);
  assert.equal(hasCompatibleShopRefundSourceInvoice({ ...payment, invoice: { ...payment.invoice, paymentId: "11111111-1111-4111-8111-111111111199" } }, payment.shopOrderId), false);
  assert.equal(hasCompatibleShopRefundSourceInvoice({ ...payment, invoice: { ...payment.invoice, shopOrderId: "11111111-1111-4111-8111-111111111198" } }, payment.shopOrderId), false);
  assert.equal(hasCompatibleShopRefundSourceInvoice({ ...payment, invoice: { ...payment.invoice, currency: "USD" } }, payment.shopOrderId), false);
  assert.equal(hasCompatibleShopRefundSourceInvoice({ ...payment, invoice: { ...payment.invoice, totalCents: 1 } }, payment.shopOrderId), false);
});

test("the state machine keeps physical receipt, inspection, refund and closure explicit", () => {
  assert.doesNotThrow(() => assertTransition("AWAITING_RETURN", "RETURN_RECEIVED"));
  assert.doesNotThrow(() => assertTransition("RETURN_RECEIVED", "INSPECTED"));
  assert.doesNotThrow(() => assertTransition("INSPECTED", "REFUND_PENDING"));
  assert.throws(() => assertTransition("AWAITING_RETURN", "REFUNDED"), ShopAfterSalesError);
  assert.throws(() => assertTransition("REFUND_PENDING", "CLOSED"), ShopAfterSalesError);
});

test("Phase 5B presentation replaces technical SAV enums without changing their persisted values", () => {
  assert.equal(shopReturnStatusLabel("CLOSED"), "Clôturée");
  assert.equal(shopReturnTypeLabel("DEFECTIVE"), "Produit défectueux");
  assert.equal(shopReturnRefundStatusLabel("NOT_REQUESTED"), "Non demandé");
  assert.equal(shopReturnRefundStatusLabel("SUCCEEDED"), "Confirmé");
  assert.equal(shopReturnRefundStatusLabel("PENDING"), "En attente");
  assert.equal(shopReturnRefundStatusLabel("FAILED"), "Échec");
  assert.equal(shopReturnRefundStatusLabel("REQUIRES_REVIEW"), "Revue requise");
  assert.equal(shopReturnCostDecisionLabel("MERCHANT"), "Vendeur");
  assert.equal(shopReturnAuditActionLabel("REFUND_CONFIRMED"), "Remboursement confirmé");
});

test("Phase 5B member UI aligns confirmations and never renders an empty tracking definition list", async () => {
  const [css, createPage, detailPage, orderPage] = await Promise.all([
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/sav/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/sav/[requestNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(createPage, /className="auth-check"[\s\S]*SHOP_RETURN_REQUEST_CONFIRMATION/);
  assert.match(createPage, /Après l’enregistrement de votre demande, vous pourrez ajouter jusqu’à 5 photos pour illustrer le problème\./);
  assert.match(createPage, /Les photos restent facultatives\./);
  assert.match(detailPage, /className="auth-check"[\s\S]*SHOP_RETURN_CANCEL_CONFIRMATION/);
  assert.match(detailPage, /<form className="shop-return-form" action=\{cancelShopReturnAction\}>/);
  assert.match(detailPage, /<dl className="auth-profile shop-return-summary">/);
  assert.match(css, /\.shop-return-form \.auth-check \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*gap: 0\.65rem;/);
  assert.match(css, /\.shop-return-summary > div \{ grid-template-columns: minmax\(9rem, 0\.45fr\) minmax\(0, 1fr\); \}/);
  assert.match(css, /\.auth-check input\[type="checkbox"\][\s\S]*flex: 0 0 1\.15rem;[\s\S]*width: 1\.15rem;/);
  assert.match(orderPage, /const hasTrackingDetails = Boolean\(order\.shippingCarrier \|\| order\.trackingNumber \|\| order\.trackingUrl\)/);
  assert.match(orderPage, /hasTrackingDetails \? <dl className="auth-profile">/);
  assert.match(orderPage, /Les informations de suivi seront affichées ici lorsqu’elles seront disponibles\./);
  assert.doesNotMatch(orderPage, /◁▷/);
});

test("service source uses PostgreSQL locks, DB ownership, stable idempotency and never couples refund to restock", async () => {
  const source = await readFile(new URL("../../lib/shop/after-sales-service.ts", import.meta.url), "utf8");
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /where: \{ orderNumber: input\.orderNumber, userId: actor\.id \}/);
  assert.match(source, /shop-return:\$\{request\.id\}:provider-refund:v1/);
  assert.match(source, /AMBIGUOUS_PROVIDER_ACCEPTANCE/);
  assert.match(source, /issueCreditNoteForRefund/);
  assert.match(source, /persistShopRefundFinalizationReview/);
  assert.match(source, /productStockAdjustment\.findUnique\(\{ where: \{ idempotencyKey: key \} \}\)/);
  const refundFunction = source.slice(source.indexOf("async function applyShopRefundEvidence"), source.indexOf("async function markAmbiguousRefund"));
  assert.doesNotMatch(refundFunction, /product\.update|productStockAdjustment\.create/);
});

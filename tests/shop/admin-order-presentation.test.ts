import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  shopPaymentAttemptPresentation,
  shopPaymentIncidentLabel,
} from "@/lib/shop/order-presentation";

test("Admin exposes ShopOrders and strictly guarded fulfillment actions", async () => {
  const [listPage, detailPage] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/commandes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(listPage, /await requireAdmin\(\)/);
  assert.match(listPage, /listAdminShopOrders/);
  assert.match(listPage, /Commandes Boutique/);
  assert.match(listPage, /Commandes Boutique/);
  assert.match(detailPage, /await requireAdmin\(\)/);
  assert.match(detailPage, /getAdminShopOrder/);
  assert.match(detailPage, /if \(!order\) notFound\(\)/);
  assert.match(detailPage, /Stock réservé/);
  assert.match(detailPage, /Adresse snapshotée/);
  assert.match(detailPage, /admin-rights-timeline/);
  assert.match(detailPage, /AWAITING_PAYMENT/);
  assert.match(detailPage, /paymentReviewAt/);
  assert.match(detailPage, /markShopOrderPreparingAction/);
  assert.match(detailPage, /markShopOrderReadyAction/);
  assert.match(detailPage, /recordShopOrderTrackingAction/);
  assert.match(detailPage, /admin-form admin-shipping-tracking-form/);
  assert.match(detailPage, /admin-payment-attempt-facts/);
  assert.match(detailPage, /markShopOrderShippedAction/);
  assert.match(detailPage, /CONFIRM_SHOP_PREPARATION/);
  assert.match(detailPage, /CONFIRM_SHOP_READY_TO_SHIP/);
  assert.match(detailPage, /CONFIRM_SHOP_TRACKING/);
  assert.match(detailPage, /CONFIRM_SHOP_SHIPMENT/);
  assert.match(detailPage, /Transporteur ou mode/);
  assert.match(detailPage, /Prête à expédier/);
  assert.match(detailPage, /ne confirme pas sa livraison/);
  assert.doesNotMatch(detailPage, />Livré</);
  assert.match(detailPage, /Aucun identifiant provider ni payload brut/);
  assert.match(detailPage, /elle ne réduit plus la disponibilité/);
  assert.match(detailPage, /Aucun mouvement de stock physique n’a été nécessaire/);
  assert.doesNotMatch(detailPage, /stock correspondant doit être libéré/);
  assert.doesNotMatch(detailPage, /providerCheckoutId|providerPaymentId|rawPayload/);
});

test("Admin navigation selects only the longest matching route and mobile orders stack", async () => {
  const [navigation, css] = await Promise.all([
    readFile(new URL("../../components/admin-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);

  assert.match(navigation, /href: "\/admin\/boutique\/commandes"/);
  assert.match(navigation, /item\.href\.length > longest\.length/);
  assert.match(navigation, /const active = activeHref === item\.href/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.admin-order-list a \{ grid-template-columns: 1fr 20px/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.admin-rights-timeline li \{ grid-template-columns: 1fr/);
  assert.match(css, /\.admin-payment-attempt-facts__compact dd \{ white-space: nowrap/);
  assert.match(css, /\.admin-shipping-tracking-form > label:not\(\.admin-check\) > input/);
  assert.match(css, /\.admin-shipping-tracking-form[\s\S]*box-sizing: border-box/);
  assert.match(css, /\.admin-shipping-tracking-form[\s\S]*focus-visible/);
});

test("Admin Shop payment presentation lists a winner and a reviewed second capture without provider ids", async () => {
  const createdAt = new Date("2026-08-27T18:00:00.000Z");
  const stripe = shopPaymentAttemptPresentation({
    provider: "STRIPE",
    status: "SUCCEEDED",
    failureCode: null,
    paidAt: new Date("2026-08-27T18:01:00.000Z"),
    createdAt,
  });
  const paypal = shopPaymentAttemptPresentation({
    provider: "PAYPAL",
    status: "REQUIRES_REVIEW",
    failureCode: "SHOP_PAYMENT_ALREADY_CAPTURED",
    paidAt: new Date("2026-08-27T18:02:00.000Z"),
    createdAt,
  });
  assert.deepEqual(
    [stripe.providerLabel, stripe.statusLabel, paypal.providerLabel, paypal.statusLabel],
    ["Carte bancaire / Apple Pay", "Confirmée", "PayPal", "À vérifier"],
  );
  assert.equal(paypal.incidentLabel, "Second encaissement détecté — vérification requise");
  assert.equal(
    shopPaymentIncidentLabel("SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW"),
    "Événement financier fournisseur — vérification requise",
  );
  assert.equal(shopPaymentIncidentLabel("UNTRUSTED_PROVIDER_TEXT"), "Anomalie financière à examiner");

  const detailPage = await readFile(
    new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detailPage, /order\.payments\.map/);
  assert.match(detailPage, /shopPaymentAttemptPresentation/);
  assert.doesNotMatch(detailPage, /providerCheckoutId|providerPaymentId|rawPayload/);
});

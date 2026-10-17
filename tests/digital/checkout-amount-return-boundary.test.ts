import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import test, { after, before, mock } from "node:test";
import type Stripe from "stripe";
import { normalizeDigitalCart, assertPaymentEvidence, type DigitalSelection, type DigitalPaymentEvidence } from "@/lib/digital/domain";
import { completeDigitalAlbum } from "@/lib/digital/completion-policy";
import { digitalStripeParameters, stripeDigitalEvidence, type DigitalProviderOrder } from "@/lib/digital/providers";
import { paypalCreateOrderBody, paypalAmountFromCents, paypalCentsFromAmount } from "@/lib/payments/paypal-client";
import { digitalBody } from "@/lib/digital/http";
import { digitalConfirmationMessage, digitalCountsOwnedRights } from "@/lib/digital/library-policy";
import { digitalContractSnapshot, digitalContractTerms, verifyContractSnapshot } from "@/lib/digital/fulfillment-policy";
import { DIGITAL_FRANCE_TERMS_VERSION } from "@/lib/digital/france-legal";

// Pure calculations and source boundaries only. No provider, PostgreSQL, media,
// browser payment, signature delivery or external recipe is executed here.
let outboundCalls = 0;
before(() => {
  const deny = () => { outboundCalls++; throw Error("NETWORK_FORBIDDEN_IN_CHECKOUT_AMOUNT_RETURN_TEST"); };
  mock.method(globalThis, "fetch", deny);
  for (const method of ["request", "get"] as const) { mock.method(http, method, deny); mock.method(https, method, deny); }
  mock.method(net, "connect", deny); mock.method(net, "createConnection", deny);
  mock.property(process, "env", { ...process.env, AUTH_URL: "http://127.0.0.1:3140" });
});
after(() => { mock.restoreAll(); assert.equal(outboundCalls, 0); });

const tracks = Array.from({ length: 12 }, (_, i) => ({ trackId: randomUUID(), masterId: randomUUID(), title: `Titre synthétique ${i + 1}`, position: i + 1 }));
function track(i = 0, priceCents = 129): DigitalSelection { return { id: randomUUID(), scope: "TRACK", title: tracks[i].title, priceCents, version: 1, tracks: [tracks[i]] }; }
function album(): DigitalSelection { return { id: randomUUID(), scope: "ALBUM", title: "Album synthétique", priceCents: 990, version: 1, tracks }; }

function assertProviderParity(selected: DigitalSelection[], owned = new Set<string>()) {
  const quote = normalizeDigitalCart(selected, owned);
  const order: DigitalProviderOrder = { id: randomUUID(), mode: "TEST", totalCents: quote.totalCents, userEmail: "synthetic@example.invalid",
    lines: quote.lines.map(line => ({ title: line.title, priceCents: line.priceCents })) };
  const attemptId = randomUUID(), stripe = digitalStripeParameters(order, attemptId);
  const paypal = paypalCreateOrderBody({ orderId: order.id, orderNumber: "DCN-TEST", paymentId: attemptId, amountCents: order.totalCents,
    currency: "EUR", description: "Musique numérique synthétique QA", itemCategory: "DIGITAL_GOODS", payeeMerchantId: "SYNTHETICSELLER",
    returnUrl: `http://127.0.0.1:3140/musique/confirmation/${order.id}`, cancelUrl: `http://127.0.0.1:3140/musique/confirmation/${order.id}?annule=1` });
  const stripeTotal = stripe.line_items!.reduce((sum, line) => {
    assert.equal(line.quantity, 1); assert.equal(line.price_data?.currency, "eur");
    assert.equal(Number.isSafeInteger(line.price_data?.unit_amount), true);
    return sum + Number(line.price_data!.unit_amount) * line.quantity!;
  }, 0);
  assert.equal(stripeTotal, quote.totalCents);
  const unit = paypal.purchase_units[0];
  assert.equal(unit.amount.currency_code, "EUR"); assert.equal(paypalCentsFromAmount(unit.amount.value), quote.totalCents);
  assert.equal(unit.items?.[0].unit_amount.value, unit.amount.value); assert.equal(unit.amount.breakdown?.item_total.value, unit.amount.value);
  assert.equal(unit.payee?.merchant_id, "SYNTHETICSELLER");
  assert.equal(stripe.success_url, paypal.payment_source.paypal.experience_context.return_url);
  assert.equal(stripe.cancel_url, paypal.payment_source.paypal.experience_context.cancel_url);
  return { quote, order, stripe, paypal };
}

test("server-normalized 129-cent title and 990-cent album produce identical Stripe/PayPal EUR totals", () => {
  const title = assertProviderParity([track()]), full = assertProviderParity([album()]);
  assert.equal(title.quote.totalCents, 129); assert.equal(title.paypal.purchase_units[0].amount.value, "1.29");
  assert.equal(full.quote.totalCents, 990); assert.equal(full.paypal.purchase_units[0].amount.value, "9.90");
});

test("multiple titles and album-covered titles are normalized once before either provider receives a total", () => {
  const first = track(), second = track(1), third = track(2);
  assert.equal(assertProviderParity([first, second, third, first]).quote.totalCents, 387);
  const full = album(), covered = assertProviderParity([first, full, second]);
  assert.equal(covered.quote.totalCents, 990); assert.deepEqual(covered.quote.lines.map(line => line.id), [full.id]);
  assert.deepEqual(new Set(covered.quote.removed), new Set([first.id, second.id]));
});

test("completion net total uses exact historical paid-less-refunded cents identically for both providers", () => {
  const sources = [
    { index: 0, paidCents: 137, refundedCents: 31 },
    { index: 1, paidCents: 49, refundedCents: 0 },
    { index: 2, paidCents: 201, refundedCents: 17 },
  ].map(({ index, paidCents, refundedCents }) => ({ trackId: tracks[index].trackId, masterId: tracks[index].masterId, sourceLineId: randomUUID(),
    paidCents, refundedCents, availableCents: paidCents - refundedCents, creditCents: paidCents - refundedCents, proofHash: "a".repeat(64) }));
  const owned = new Set(sources.map(source => source.trackId)), completed = completeDigitalAlbum(album(), owned, sources);
  const result = assertProviderParity([completed], owned);
  assert.equal(completed.completion?.creditCents, 339); assert.equal(result.quote.totalCents, 651);
  assert.equal(result.paypal.purchase_units[0].amount.value, "6.51");
  assert.deepEqual(completed.completion?.sources.map(source => source.paidCents).sort((a, b) => a - b), [49, 137, 201]);
});

test("money conversion rejects fractional inputs and does not round a browser float into an authorized charge", () => {
  for (const amount of [1, 9, 10, 99, 100, 129, 387, 651, 990, 500000]) assert.equal(paypalCentsFromAmount(paypalAmountFromCents(amount)), amount);
  for (const amount of [0, -1, 129.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => paypalAmountFromCents(amount));
  for (const value of ["1.290", "1,29", "01.29", "1.2", 1.29]) assert.throws(() => paypalCentsFromAmount(value));
  assert.throws(() => normalizeDigitalCart([track(0, 129.1)], new Set()), { code: "INVALID_PRICE" });
});

test("the real checkout body allowlist rejects client total, price, line items and forged paid/return flags", async () => {
  const source = await readFile(new URL("../../app/api/digital/checkout/route.ts", import.meta.url), "utf8");
  const serialized = source.match(/digitalBody\(request,(\[[^\]]+\])\)/)?.[1];
  assert.ok(serialized, "The actual checkout route must declare its strict body allowlist");
  const allowed = JSON.parse(serialized) as string[];
  const payload = { idempotencyKey: randomUUID(), revision: 1, provider: "STRIPE", termsVersion: DIGITAL_FRANCE_TERMS_VERSION,
    termsAccepted: true, earlyDelivery: true, withdrawalAcknowledged: true };
  const request = (body: unknown) => new Request("http://127.0.0.1:3140/api/digital/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.deepEqual(await digitalBody(request(payload), allowed), payload);
  for (const field of ["totalCents", "amountCents", "priceCents", "lineItems", "paid", "payment_status", "success", "annule"]) {
    assert.equal(allowed.includes(field), false);
    await assert.rejects(digitalBody(request({ ...payload, [field]: field === "lineItems" ? [] : 1 }), allowed), { code: "INVALID_BODY" });
  }
});

test("a browser success/cancel return cannot create paid evidence for an incomplete or unpaid Stripe session", () => {
  const id = randomUUID(), base = { id: "cs_test_synthetic", livemode: false, client_reference_id: id, amount_total: 129, currency: "eur",
    payment_intent: "pi_synthetic", status: "open", payment_status: "unpaid",
    metadata: { paymentSource: "DIGITAL_MUSIC", digitalOrderId: id, digitalAttemptId: randomUUID(), mode: "TEST" } };
  for (const flags of [{ success: "1" }, { annule: "1" }, { paid: "true" }, { status: "complete", payment_status: "unpaid" }]) {
    const evidence = stripeDigitalEvidence({ ...base, ...flags } as unknown as Stripe.Checkout.Session, "evt_synthetic", "acct_synthetic");
    assert.equal(evidence.status, "PENDING"); assert.equal(digitalCountsOwnedRights(evidence.status, "ACTIVE"), false);
    assert.match(digitalConfirmationMessage(evidence.status, false), /Aucun téléchargement débloqué/);
  }
  const expired = stripeDigitalEvidence({ ...base, status: "expired", success: "1" } as unknown as Stripe.Checkout.Session, "evt_expired_synthetic", "acct_synthetic");
  assert.equal(expired.status, "FAILED"); assert.equal(digitalCountsOwnedRights(expired.status, "ACTIVE"), false);
  assert.match(digitalConfirmationMessage(expired.status, false), /Aucun accès délivré/);
});

test("confirmation page remains read-only and ownership-scoped before exposing document or order state", async () => {
  const page = await readFile(new URL("../../app/musique/confirmation/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireVerifiedUser\(`/);
  assert.match(page, /getDigitalOrderStatus\(s\.user\.id,id\)/);
  assert.equal(page.indexOf("getDigitalOrderStatus(s.user.id,id)") < page.indexOf("prisma.digitalOrder.findUniqueOrThrow"), true);
  assert.doesNotMatch(page, /searchParams|reconcileDigitalEvidence|reconcileDigitalOrder|captureDigitalPaypal|digitalEntitlement\.(?:create|update|upsert)/);
  const commerce = await readFile(new URL("../../lib/digital/commerce.ts", import.meta.url), "utf8");
  const ownerLookup = commerce.slice(commerce.indexOf("export async function getDigitalOrderStatus"), commerce.indexOf("export async function reconcileDigitalEvidence"));
  assert.match(ownerLookup, /findFirst\(\{ where: \{ id, userId,mode \}/);
  assert.match(ownerLookup, /if \(!order\) throw new DigitalError\("NOT_FOUND", 404\)/);
  assert.doesNotMatch(ownerLookup, /\.(?:create|update|upsert|delete)\(/);
});

test("server payment evidence binds amount/currency/merchant/order/provider independently of return labels", () => {
  const id = randomUUID(), expected = { id, totalCents: 129, mode: "TEST" }, attempt = { provider: "STRIPE", providerReference: "cs_test_synthetic" };
  const evidence: DigitalPaymentEvidence = { eventId: "evt_synthetic", orderId: id, provider: "STRIPE", mode: "TEST", providerReference: attempt.providerReference,
    paymentReference: "pi_synthetic", merchantId: "acct_synthetic", amountCents: 129, currency: "EUR", status: "PAID", authenticated: true };
  assert.doesNotThrow(() => assertPaymentEvidence(evidence, expected, attempt, "acct_synthetic"));
  for (const changed of [{ authenticated: false }, { amountCents: 128 }, { amountCents: 129.1 }, { currency: "USD" }, { merchantId: "acct_other" },
    { orderId: randomUUID() }, { providerReference: "cs_other" }, { paymentReference: "" }, { mode: "LIVE" as const }, { provider: "PAYPAL" as const }]) {
    assert.throws(() => assertPaymentEvidence({ ...evidence, ...changed }, expected, attempt, "acct_synthetic"), { code: "PAYMENT_REQUIRES_REVIEW" });
  }
});

test("contract receipt keeps the exact accepted text/hash and rejects changed terms or missing consent", () => {
  const terms = digitalContractTerms(DIGITAL_FRANCE_TERMS_VERSION), accepted = new Date("2026-10-16T18:00:00.000Z");
  const saved = digitalContractSnapshot({ email: "synthetic@example.invalid", name: "Acheteur synthétique" }, accepted, DIGITAL_FRANCE_TERMS_VERSION);
  const before = JSON.stringify(saved);
  assert.equal(verifyContractSnapshot(saved, DIGITAL_FRANCE_TERMS_VERSION, terms.hash).termsHash, terms.hash);
  for (const changed of [{ ...saved, terms: { ...saved.terms, text: "Un autre contrat" } }, { ...saved, earlyDelivery: { ...saved.earlyDelivery, expresslyRequested: false } },
    { ...saved, withdrawal: { ...saved.withdrawal, expresslyAcknowledged: false } }]) {
    assert.throws(() => verifyContractSnapshot(changed, DIGITAL_FRANCE_TERMS_VERSION, terms.hash), { code: "CONTRACT_REQUIRES_REVIEW" });
  }
  assert.throws(() => verifyContractSnapshot(saved, DIGITAL_FRANCE_TERMS_VERSION, "0".repeat(64)), { code: "CONTRACT_REQUIRES_REVIEW" });
  assert.equal(JSON.stringify(saved), before);
});

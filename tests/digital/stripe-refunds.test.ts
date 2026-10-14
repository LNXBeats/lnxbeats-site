import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { digitalFinanceGateway } from "@/lib/digital/finance-providers";
import {
  readStripeChargeRefunds,
  stripeRefundEvidence,
  stripeRefundWebhookPayload,
} from "@/lib/digital/stripe-refunds";

// All objects below are local doubles: constructing them never creates a Stripe
// client, reads credentials, or calls a provider.
const expected = {
  orderId: "c7a03dd8-e103-40fa-ac04-9c9aa421e758",
  attemptId: "458649b7-645c-46e0-afc5-dc0347d71fd3",
  paymentReference: "pi_refundQa",
  merchantId: "acct_refundQa",
  amountCents: 1_000,
};
const refundId = "2640bdce-96ae-48a5-b1f3-5cd42f6b3a49";
const chargeReference = "ch_refundQa";
const paymentMetadata = {
  paymentSource: "DIGITAL_MUSIC",
  digitalOrderId: expected.orderId,
  digitalAttemptId: expected.attemptId,
  mode: "TEST",
};
function refund(id = "re_refundQa", amount = 1_000, status = "succeeded", localRefundId = refundId) {
  const metadata: Record<string, string> = {
    paymentSource: "DIGITAL_MUSIC", digitalOrderId: expected.orderId, digitalRefundId: localRefundId,
  };
  return {
    id, object: "refund", payment_intent: expected.paymentReference,
    charge: chargeReference, currency: "eur", amount, status,
    metadata,
  };
}
function charge(amountRefunded = 1_000) {
  return {
    id: chargeReference, object: "charge", livemode: false,
    payment_intent: expected.paymentReference, amount: expected.amountCents,
    amount_captured: expected.amountCents, amount_refunded: amountRefunded,
    currency: "eur", paid: true, captured: true,
    refunded: amountRefunded === expected.amountCents,
    metadata: paymentMetadata, transfer_data: null, on_behalf_of: null,
  };
}
function intent(amountRefunded = 1_000) {
  return {
    id: expected.paymentReference, object: "payment_intent", livemode: false,
    status: "succeeded", amount: expected.amountCents,
    amount_received: expected.amountCents, currency: "eur",
    metadata: paymentMetadata, latest_charge: charge(amountRefunded),
    transfer_data: null, on_behalf_of: null,
  };
}
type Page = { data: ReturnType<typeof refund>[]; has_more: boolean };
type Client = Parameters<typeof readStripeChargeRefunds>[0];
function fakeClient(options: {
  account?: unknown; paymentIntent?: unknown;
  pages?: Page[];
} = {}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const pages = options.pages ?? [{ data: [refund()], has_more: false }];
  let index = 0;
  const client = {
    accounts: { async retrieve(value: unknown) {
      calls.push({ operation: "account", value });
      return options.account ?? { id: expected.merchantId };
    } },
    paymentIntents: { async retrieve(id: unknown, params: unknown) {
      calls.push({ operation: "intent", value: { id, params } });
      return options.paymentIntent ?? intent();
    } },
    refunds: { async list(params: unknown) {
      calls.push({ operation: "refunds", value: params });
      return pages[Math.min(index++, pages.length - 1)];
    } },
  } as unknown as Client;
  return { client, calls };
}

test("charge.refunded without refunds reproduces the real payload without treating ch_ as a refund", () => {
  assert.deepEqual(stripeRefundWebhookPayload("charge.refunded", {
    id: chargeReference, object: "charge", payment_intent: expected.paymentReference,
  }), { paymentReference: expected.paymentReference, resourceReference: chargeReference });
});

test("absent, null, empty and truncated embedded charge refunds never change the charge resource identity", () => {
  for (const embedded of [undefined, null, { data: [] }, { data: [refund("re_embeddedQa", 200)], has_more: true }]) {
    const payload = stripeRefundWebhookPayload("charge.refunded", {
      id: chargeReference, object: "charge", payment_intent: { id: expected.paymentReference },
      ...(embedded === undefined ? {} : { refunds: embedded }),
    });
    assert.equal(payload.paymentReference, expected.paymentReference);
    assert.equal(payload.resourceReference, chargeReference);
    for (const id of payload.refundReferences ?? []) assert.ok(id.startsWith("re_"));
    assert.ok(!(payload.refundReferences ?? []).includes(chargeReference));
  }
});

test("refund.created, updated and failed preserve only a refund resource reference", () => {
  for (const eventType of ["refund.created", "refund.updated", "refund.failed"]) {
    const payload = stripeRefundWebhookPayload(eventType, refund());
    assert.equal(payload.paymentReference, expected.paymentReference);
    assert.equal(payload.resourceReference, "re_refundQa");
  }
});

test("charge/refund prefix confusion and malformed embedded refund identifiers fail closed", () => {
  for (const [type, object] of [
    ["charge.refunded", { id: "re_notACharge", payment_intent: expected.paymentReference }],
    ["refund.updated", { ...refund(), id: chargeReference }],
    ["charge.refunded", { id: chargeReference, payment_intent: expected.paymentReference, refunds: { data: [{ id: chargeReference }] } }],
    ["charge.refunded", { id: chargeReference, payment_intent: expected.paymentReference, refunds: { data: [null] } }],
  ] as const) assert.throws(() => stripeRefundWebhookPayload(type, object));
});

test("fresh charge reconciliation uses expected account, expanded PaymentIntent and a charge-filtered refund list", async () => {
  const { client, calls } = fakeClient();
  const evidence = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].reference, "re_refundQa");
  assert.equal(evidence[0].paymentReference, expected.paymentReference);
  assert.equal(evidence[0].amountCents, expected.amountCents);
  assert.equal(evidence[0].status, "SUCCEEDED");
  assert.equal(evidence[0].localRefundId, refundId);
  assert.deepEqual(calls, [
    { operation: "account", value: null },
    { operation: "intent", value: { id: expected.paymentReference, params: { expand: ["latest_charge"] } } },
    { operation: "refunds", value: { charge: chargeReference, limit: 100 } },
  ]);
});

test("fresh pagination gathers distinct partial refunds into the complete amount without trusting an embedded list", async () => {
  const { client, calls } = fakeClient({
    paymentIntent: { ...intent(), latest_charge: { ...charge(), refunds: { data: [refund("re_staleQa", 1)], has_more: false } } },
    pages: [
      { data: [refund("re_partialNewQa", 400)], has_more: true },
      { data: [refund("re_partialOldQa", 600, "succeeded", "4b5cb702-bb5e-4098-abce-9c35e37b893e")], has_more: false },
    ],
  });
  const evidence = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.deepEqual(evidence.map(r => [r.reference, r.amountCents]), [["re_partialNewQa", 400], ["re_partialOldQa", 600]]);
  assert.equal(evidence.reduce((sum, r) => sum + r.amountCents, 0), expected.amountCents);
  assert.deepEqual(calls.filter(c => c.operation === "refunds").map(c => c.value), [
    { charge: chargeReference, limit: 100 },
    { charge: chargeReference, limit: 100, starting_after: "re_partialNewQa" },
  ]);
});

test("a partially refunded charge is not mistaken for a complete refund", async () => {
  const { client } = fakeClient({ paymentIntent: intent(400), pages: [{ data: [refund("re_partialQa", 400)], has_more: false }] });
  const evidence = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.deepEqual(evidence.map(r => r.amountCents), [400]);
});

test("an incomplete fresh list is not acknowledged as a fully reconciled refunded charge", async () => {
  for (const pages of [
    [{ data: [], has_more: false }],
    [{ data: [refund("re_partialQa", 400)], has_more: false }],
    [{ data: [], has_more: true }],
  ]) {
    const { client } = fakeClient({ pages });
    await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
  }
});

test("duplicated refund IDs across pages are rejected rather than counted twice", async () => {
  const r = refund("re_duplicateQa", 500);
  const { client } = fakeClient({ pages: [{ data: [r], has_more: true }, { data: [r], has_more: false }] });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
});

test("fresh refund pagination has a hard page bound and rejects a non-terminating sequence", async () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ data: [refund(`re_page${i}Qa`, 1)], has_more: true }));
  const { client, calls } = fakeClient({ pages });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
  assert.ok(calls.filter(c => c.operation === "refunds").length <= 4);
});

test("more than one hundred refunds are never silently truncated", async () => {
  const pages = [
    { data: Array.from({ length: 100 }, (_, i) => refund(`re_item${i}Qa`, 1)), has_more: true },
    { data: [refund("re_overflowQa", 1)], has_more: false },
  ];
  const { client } = fakeClient({ pages });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
});

test("one hundred complete refund results fit the explicit bound without truncation", async () => {
  const refunds = Array.from({ length: 100 }, (_, i) => ({ ...refund(`re_bounded${i}Qa`, 10), metadata: {} }));
  const { client } = fakeClient({ pages: [{ data: refunds, has_more: false }] });
  const evidence = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.equal(evidence.length, 100);
  assert.equal(new Set(evidence.map(r => r.reference)).size, 100);
  assert.equal(evidence.reduce((sum, r) => sum + r.amountCents, 0), expected.amountCents);
});

test("wrong merchant rejects before reading the PaymentIntent or refund list", async () => {
  const { client, calls } = fakeClient({ account: { id: "acct_otherQa" } });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
  assert.deepEqual(calls.map(c => c.operation), ["account"]);
});

test("wrong TEST payment, ownership, currency, amount or Connect context rejects before listing refunds", async () => {
  for (const patch of [
    { livemode: true }, { id: "pi_otherQa" }, { currency: "usd" },
    { amount_received: 999 }, { status: "processing" },
    { metadata: { ...paymentMetadata, paymentSource: "SUPPORT" } },
    { metadata: { ...paymentMetadata, digitalOrderId: "c09e62c0-9d7c-4613-b8ac-b3ccda7455d4" } },
    { metadata: { ...paymentMetadata, digitalAttemptId: "6bcb4b93-4a06-4a77-af5a-358d7648b62f" } },
    { transfer_data: { destination: "acct_connectedQa" } },
    { on_behalf_of: "acct_connectedQa" },
  ]) {
    const { client, calls } = fakeClient({ paymentIntent: { ...intent(), ...patch } });
    await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
    assert.equal(calls.filter(c => c.operation === "refunds").length, 0);
  }
});

test("a payment with explicit LIVE metadata remains rejected even when livemode is false", async () => {
  const { client, calls } = fakeClient({ paymentIntent: { ...intent(), metadata: { ...paymentMetadata, mode: "LIVE" } } });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference), { code: "REFUND_EVIDENCE_INVALID" });
  assert.equal(calls.filter(c => c.operation === "refunds").length, 0);
});

test("wrong charge identity, TEST context, paid/captured proof or currency rejects before listing refunds", async () => {
  for (const patch of [
    { id: "ch_otherQa" }, { livemode: true }, { currency: "usd" },
    { payment_intent: "pi_otherQa" }, { paid: false }, { captured: false },
    { amount: 999 }, { amount_captured: 999 }, { amount_refunded: 1_001 },
    { transfer_data: { destination: "acct_connectedQa" } },
    { on_behalf_of: "acct_connectedQa" },
  ]) {
    const { client, calls } = fakeClient({ paymentIntent: { ...intent(), latest_charge: { ...charge(), ...patch } } });
    await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
    assert.equal(calls.filter(c => c.operation === "refunds").length, 0);
  }
});

test("non-expanded or missing latest charge remains ambiguous and is not converted to refund evidence", async () => {
  for (const latest_charge of [chargeReference, null, undefined]) {
    const { client } = fakeClient({ paymentIntent: { ...intent(), latest_charge } });
    await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
  }
});

test("refund evidence rejects charge IDs, mismatched payment/currency and invalid amounts", () => {
  for (const patch of [
    { id: chargeReference }, { payment_intent: "pi_otherQa" },
    { currency: "usd" }, { amount: 0 }, { amount: 1_001 }, { amount: 1.5 },
    { metadata: { paymentSource: "SUPPORT", digitalOrderId: expected.orderId } },
    { metadata: { paymentSource: "DIGITAL_MUSIC", digitalOrderId: "c09e62c0-9d7c-4613-b8ac-b3ccda7455d4" } },
  ]) assert.throws(() => stripeRefundEvidence({ ...refund(), ...patch }, expected));
});

test("fresh refund evidence retains pending and failed states and does not trust webhook arrival order", async () => {
  for (const [status, expectedStatus] of [["pending", "PENDING"], ["requires_action", "PENDING"], ["failed", "FAILED"], ["canceled", "FAILED"]] as const) {
    assert.equal(stripeRefundEvidence(refund("re_stateQa", 400, status), expected).status, expectedStatus);
  }
  const { client } = fakeClient();
  const first = await readStripeChargeRefunds(client, expected, chargeReference);
  const second = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.deepEqual(second, first);
});

test("provider refunds without application metadata remain identifiable but never invent a local refund UUID", () => {
  for (const metadata of [null, {}, undefined]) {
    const evidence = stripeRefundEvidence({ ...refund(), metadata }, expected);
    assert.equal(evidence.reference, "re_refundQa");
    assert.equal(evidence.localRefundId, undefined);
  }
  for (const metadata of [
    { paymentSource: "DIGITAL_MUSIC", digitalOrderId: expected.orderId },
    { paymentSource: "DIGITAL_MUSIC", digitalOrderId: expected.orderId, digitalRefundId: chargeReference },
    { digitalRefundId: refundId },
  ]) assert.throws(() => stripeRefundEvidence({ ...refund(), metadata }, expected));
});

test("contradictory digital order metadata is rejected even without an application paymentSource", () => {
  assert.throws(() => stripeRefundEvidence({ ...refund(), metadata: {
    digitalOrderId: "c09e62c0-9d7c-4613-b8ac-b3ccda7455d4",
  } }, expected), { code: "REFUND_EVIDENCE_INVALID" });
});

test("failed refunds do not inflate refunded amount and pending refunds never become successful evidence", async () => {
  const { client } = fakeClient({ paymentIntent: intent(400), pages: [{
    data: [
      { ...refund("re_succeededQa", 400), metadata: {} },
      { ...refund("re_pendingQa", 300, "pending"), metadata: {} },
      { ...refund("re_failedQa", 400, "failed"), metadata: {} },
    ], has_more: false,
  }] });
  const evidence = await readStripeChargeRefunds(client, expected, chargeReference);
  assert.equal(evidence.filter(r => r.status === "SUCCEEDED").reduce((sum, r) => sum + r.amountCents, 0), 400);
  assert.equal(evidence.find(r => r.reference === "re_pendingQa")?.status, "PENDING");
  assert.equal(evidence.find(r => r.reference === "re_failedQa")?.status, "FAILED");
});

test("cross-charge refunds in a charge-filtered list fail closed", async () => {
  const foreignRefund = { ...refund(), charge: "ch_otherQa" };
  const { client } = fakeClient({ pages: [{ data: [foreignRefund], has_more: false }] });
  await assert.rejects(readStripeChargeRefunds(client, expected, chargeReference));
});

test("the real digital finance gateway rejects ch_ as a refund before SQL or any provider request", async t => {
  const configured = {
    DCN_ENABLED: "true", DCN_MODE: "TEST", RAILWAY_ENVIRONMENT_NAME: "local-refund-test",
    MEDIA_DEPLOYMENT_ENV: "local", PAYMENT_DEPLOYMENT_ENV: "local",
    DCN_EXTERNAL_TEST_AUTHORIZED: "true", DCN_STRIPE_SECRET_KEY: "sk_test_LOCAL_DUMMY_ONLY",
    DCN_STRIPE_ACCOUNT_ID: expected.merchantId, DCN_STRIPE_WEBHOOK_SECRET: "whsec_LOCAL_DUMMY_ONLY",
  };
  const old = new Map(Object.keys(configured).map(name => [name, process.env[name]]));
  // Prisma model delegates are Proxy methods, not property descriptors mockable
  // by node:test. Trap the transport instead: any SQL connection is forbidden.
  const databaseTransport = t.mock.method(net.Socket.prototype, "connect", () => {
    throw Error("Unexpected TCP connection in the local identifier guard test");
  });
  const requestHttp = t.mock.method(http, "request", () => {
    throw Error("Unexpected HTTP request in the local identifier guard test");
  });
  const requestHttps = t.mock.method(https, "request", () => {
    throw Error("Unexpected HTTPS request in the local identifier guard test");
  });
  const requestFetch = t.mock.method(globalThis, "fetch", async () => {
    throw Error("Unexpected fetch in the local identifier guard test");
  });
  try {
    Object.assign(process.env, configured);
    const gateway = digitalFinanceGateway("STRIPE");
    await assert.rejects(gateway.readRefund(expected.orderId, chargeReference), { code: "REFUND_EVIDENCE_INVALID" });
    assert.equal(databaseTransport.mock.calls.length, 0);
    assert.equal(requestHttp.mock.calls.length, 0);
    assert.equal(requestHttps.mock.calls.length, 0);
    assert.equal(requestFetch.mock.calls.length, 0);
  } finally {
    for (const [name, value] of old) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    t.mock.restoreAll();
  }
});

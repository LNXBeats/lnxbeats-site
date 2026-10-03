/** Local disposable PostgreSQL only. Provider calls are explicitly FAKE: this
 * proves database concurrency/idempotence, not real Stripe/PayPal settlement. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { captureSupportContribution, createSupportCheckout, getSupportStatus, reconcileSupportEvidence, supportHash } from "@/lib/support/service";
import type { SupportEvidence, SupportSnapshot } from "@/lib/support/providers";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
assert.equal(url.pathname, "/lnx_vfinal_support_test");
process.env.SUPPORT_ENABLED = "true";
process.env.SUPPORT_TEST_MODE = "true";
process.env.SITE_URL = "http://127.0.0.1:3000";
process.env.PAYMENT_DEPLOYMENT_ENV = "development";
delete process.env.RAILWAY_ENVIRONMENT_NAME;

const ownerToken = randomBytes(32).toString("hex");
const created = new Set<string>();
const references = new Map<string, string>();
const providerCalls: string[] = [];
let timeoutOnce = false;
const gateway = {
  async createCheckout(value: SupportSnapshot, _base: string, key: string) {
    providerCalls.push(key); created.add(value.id);
    const id = references.get(key) ?? `qa_${randomUUID()}`;
    references.set(key, id);
    if (timeoutOnce) { timeoutOnce = false; throw new Error("Synthetic provider response timeout"); }
    return { id, url: `https://checkout.stripe.com/c/test_${value.id}` };
  },
  async capture(value: SupportSnapshot, key: string): Promise<SupportEvidence> {
    providerCalls.push(key);
    return { contributionId: value.id, provider: "PAYPAL", providerReference: value.providerReference!,
      paymentReference: `qa_capture_${value.id}`, amountCents: value.amountCents, currency: "EUR", status: "SUCCEEDED" };
  },
};
const financialBefore = await Promise.all([prisma.order.count(), prisma.payment.count(), prisma.shopOrder.count()]);

after(async () => {
  assert.deepEqual(await Promise.all([prisma.order.count(), prisma.payment.count(), prisma.shopOrder.count()]), financialBefore);
  const own = await prisma.supportContribution.findMany({ where: { ownerHash: supportHash(ownerToken) }, select: { id: true } });
  own.forEach(({ id }) => created.add(id));
  const ids = [...created];
  await prisma.supportContributionEvent.deleteMany({ where: { contributionId: { in: ids } } });
  await prisma.supportContributionAttempt.deleteMany({ where: { contributionId: { in: ids } } });
  await prisma.supportContribution.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("ten simultaneous checkout requests share one contribution/attempt/provider key", async () => {
  const key = randomUUID();
  const result = await Promise.all(Array.from({ length: 10 }, () => createSupportCheckout({ provider: "STRIPE", amountCents: 500, idempotencyKey: key, ownerToken }, gateway)));
  assert.equal(new Set(result.map((value) => value.contributionId)).size, 1);
  const id = result[0].contributionId;
  assert.equal(await prisma.supportContributionAttempt.count({ where: { contributionId: id } }), 1);
  assert.equal(new Set(providerCalls).size, 1);
  assert.equal(await prisma.supportContributionEvent.count({ where: { contributionId: id } }), 1);
});

test("timeout then retry retains the original provider idempotency key/reference", async () => {
  const idempotencyKey = randomUUID(); timeoutOnce = true;
  const input = { provider: "STRIPE", amountCents: 300, idempotencyKey, ownerToken };
  await assert.rejects(createSupportCheckout(input, gateway), /Synthetic/);
  const key = providerCalls.at(-1)!;
  const result = await createSupportCheckout(input, gateway);
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id: result.contributionId } });
  assert.equal(value.providerReference, references.get(key));
  assert.equal(providerCalls.at(-1), key);
});

test("stale ambiguous checkout refuses a new provider request", async () => {
  const input = { provider: "STRIPE", amountCents: 1000, idempotencyKey: randomUUID(), ownerToken }; timeoutOnce = true;
  await assert.rejects(createSupportCheckout(input, gateway));
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { idempotencyKey: supportHash(`${supportHash(ownerToken)}:${input.idempotencyKey}`) } });
  await prisma.supportContributionAttempt.updateMany({ where: { contributionId: value.id }, data: { createdAt: new Date(Date.now() - 31 * 60000) } });
  const before = providerCalls.length;
  await assert.rejects(createSupportCheckout(input, gateway), (error: unknown) => (error as { code: string }).code === "CONFLICT");
  assert.equal(providerCalls.length, before);
});

test("same request key with a changed amount is rejected", async () => {
  const input = { provider: "STRIPE", amountCents: 1000, idempotencyKey: randomUUID(), ownerToken };
  await createSupportCheckout(input, gateway);
  await assert.rejects(createSupportCheckout({ ...input, amountCents: 2000 }, gateway), (error: unknown) => (error as { code: string }).code === "CONFLICT");
});

test("twenty duplicate paid webhooks apply one audit event under real PostgreSQL locking", async () => {
  const result = await createSupportCheckout({ provider: "STRIPE", amountCents: 500, idempotencyKey: randomUUID(), ownerToken }, gateway);
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id: result.contributionId } });
  const evidence: SupportEvidence = { contributionId: value.id, provider: "STRIPE", providerReference: value.providerReference!, amountCents: 500, currency: "EUR", paymentReference: `qa_pi_${value.id}`, status: "SUCCEEDED" };
  const key = `qa:paid:${randomUUID()}`;
  await Promise.all(Array.from({ length: 20 }, () => reconcileSupportEvidence(evidence, key)));
  assert.equal(await prisma.supportContributionEvent.count({ where: { eventKey: key } }), 1);
  assert.equal((await getSupportStatus(value.id, ownerToken)).status, "SUCCEEDED");
  await reconcileSupportEvidence({ ...evidence, status: "FAILED" }, `qa:late-failure:${value.id}`);
  assert.equal((await getSupportStatus(value.id, ownerToken)).status, "SUCCEEDED");
});

test("amount mismatch is recorded for review and never marks paid", async () => {
  const result = await createSupportCheckout({ provider: "STRIPE", amountCents: 500, idempotencyKey: randomUUID(), ownerToken }, gateway);
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id: result.contributionId } });
  await reconcileSupportEvidence({ contributionId: value.id, provider: "STRIPE", providerReference: value.providerReference!, amountCents: 501, currency: "EUR", paymentReference: "qa_mismatch", status: "SUCCEEDED" }, `qa:mismatch:${value.id}`);
  assert.equal((await getSupportStatus(value.id, ownerToken)).status, "REQUIRES_REVIEW");
});

test("opaque ownership prevents another browser from querying or capturing a contribution", async () => {
  const result = await createSupportCheckout({ provider: "PAYPAL", amountCents: 500, idempotencyKey: randomUUID(), ownerToken }, gateway);
  const stranger = randomBytes(32).toString("hex");
  await assert.rejects(getSupportStatus(result.contributionId, stranger), (error: unknown) => (error as { code: string }).code === "NOT_FOUND");
  await assert.rejects(captureSupportContribution(result.contributionId, stranger, gateway), (error: unknown) => (error as { code: string }).code === "NOT_FOUND");
});

test("PayPal capture retry uses same provider key and one successful capture survives replay", async () => {
  const result = await createSupportCheckout({ provider: "PAYPAL", amountCents: 2000, idempotencyKey: randomUUID(), ownerToken }, gateway);
  await Promise.all(Array.from({ length: 5 }, () => captureSupportContribution(result.contributionId, ownerToken, gateway)));
  assert.equal((await getSupportStatus(result.contributionId, ownerToken)).status, "SUCCEEDED");
  assert.equal(await prisma.supportContributionAttempt.count({ where: { contributionId: result.contributionId, operation: "CAPTURE" } }), 1);
  const before = providerCalls.length;
  await captureSupportContribution(result.contributionId, ownerToken, gateway);
  assert.equal(providerCalls.length, before);
});

test("an ambiguous capture followed by mismatched evidence blocks every new provider call", async () => {
  const result = await createSupportCheckout({ provider: "PAYPAL", amountCents: 500, idempotencyKey: randomUUID(), ownerToken }, gateway);
  const ambiguous = { ...gateway, async capture(value: SupportSnapshot, key: string): Promise<SupportEvidence> {
    providerCalls.push(key); throw new Error(`Synthetic ambiguous capture ${value.id}`);
  } };
  await assert.rejects(captureSupportContribution(result.contributionId, ownerToken, ambiguous), /Synthetic ambiguous/);
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id: result.contributionId } });
  await reconcileSupportEvidence({ contributionId: value.id, provider: "PAYPAL", providerReference: value.providerReference!, amountCents: 501, currency: "EUR", paymentReference: `qa_bad_${value.id}`, status: "SUCCEEDED" }, `qa:blocked:${value.id}`);
  const before = providerCalls.length;
  await assert.rejects(captureSupportContribution(value.id, ownerToken, gateway), (error: unknown) => (error as { code: string }).code === "CONFLICT");
  assert.equal(providerCalls.length, before);
  assert.equal((await getSupportStatus(value.id, ownerToken)).status, "REQUIRES_REVIEW");
  assert.equal((await prisma.supportContributionAttempt.findUniqueOrThrow({ where: { contributionId_operation: { contributionId: value.id, operation: "CAPTURE" } } })).status, "REQUESTED");
});

test("a confirmed PENDING capture is never re-captured, including beyond thirty minutes", async () => {
  const result = await createSupportCheckout({ provider: "PAYPAL", amountCents: 500, idempotencyKey: randomUUID(), ownerToken }, gateway);
  const pending = { ...gateway, async capture(value: SupportSnapshot, key: string): Promise<SupportEvidence> {
    return { ...await gateway.capture(value, key), status: "PENDING" };
  } };
  assert.equal((await captureSupportContribution(result.contributionId, ownerToken, pending)).status, "PENDING");
  await prisma.supportContributionAttempt.updateMany({ where: { contributionId: result.contributionId, operation: "CAPTURE" }, data: { createdAt: new Date(Date.now() - 24 * 3600000) } });
  const before = providerCalls.length;
  for (let index = 0; index < 5; index++) assert.equal((await captureSupportContribution(result.contributionId, ownerToken, gateway)).status, "PENDING");
  assert.equal(providerCalls.length, before);
});

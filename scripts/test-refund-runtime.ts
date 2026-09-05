import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { OrderActor } from "@/lib/orders/domain";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { PaypalClientError } from "@/lib/payments/paypal-client";
import { issueInvoiceForPayment } from "@/lib/billing/service";
import {
  createRefundDatabaseRepository,
  refundableAmount,
  reconcileRefundAttemptForAdmin,
  requestRefundForOrder,
  type RefundDependencies,
  type RefundProviderEvidence,
} from "@/lib/payments/refund";
import {
  processVerifiedPaypalFinancialEvent,
  processVerifiedStripeFinancialEvent,
} from "@/lib/payments/provider-financial-events";
import { prisma } from "@/lib/prisma";

const REFUND_QA_TARGET = "lnx-studio-v076-test";
const REFUND_QA_PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v076-test/server.json";
const QA_EMAILS = ["lnx-v076-refund-admin@example.invalid", "lnx-v076-refund-member@example.invalid"] as const;
const QA_ORDERS = [
  "LNX-2099-076001",
  "LNX-2099-076002",
  "LNX-2099-076003",
  "LNX-2099-076004",
  "LNX-2099-076005",
  "LNX-2099-076006",
  "LNX-2099-076007",
] as const;
const EVENT_PREFIX = "evt_v076_refund_";

async function assertRefundQaDatabase() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.LNX_DATABASE_TARGET, REFUND_QA_TARGET);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, REFUND_QA_PROOF_FILE);
  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(decodeURIComponent(databaseUrl.pathname), "/template1");
  const proof = JSON.parse(await readFile(REFUND_QA_PROOF_FILE, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, REFUND_QA_TARGET);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  try {
    process.kill(Number(proof.pid), 0);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EPERM") throw error;
  }
  return REFUND_QA_TARGET;
}

async function assertClean(stage: string) {
  const [users, orders, events] = await Promise.all([
    prisma.user.count({ where: { email: { in: [...QA_EMAILS] } } }),
    prisma.order.count({ where: { orderNumber: { in: [...QA_ORDERS] } } }),
    prisma.providerEvent.count({ where: { providerEventId: { startsWith: EVENT_PREFIX } } }),
  ]);
  assert.deepEqual({ users, orders, events }, { users: 0, orders: 0, events: 0 }, `${stage} fixture isolation failed`);
}

async function createOrderPayment(input: {
  orderNumber: (typeof QA_ORDERS)[number];
  userId: string;
  customerEmail: string;
  orderStatus: "AWAITING_PAYMENT" | "IN_PROGRESS" | "DELIVERED";
  provider?: "STRIPE" | "PAYPAL";
  amountCents?: number;
  providerPaymentId?: string;
  issueInvoice?: boolean;
}) {
  const order = await prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      userId: input.userId,
      customerEmail: input.customerEmail,
      customerName: "Refund Runtime QA",
      status: input.orderStatus,
      title: `Refund QA ${input.orderNumber}`,
      brief: "Commande fictive jetable pour la validation PostgreSQL V0.7.6.",
      totalCents: input.amountCents ?? 9_000,
      basePriceCents: input.amountCents ?? 9_000,
      submittedAt: new Date(),
      ...(input.orderStatus === "IN_PROGRESS" ? { serviceStartedAt: new Date() } : {}),
      ...(input.orderStatus === "DELIVERED" ? { serviceStartedAt: new Date(), deliveredAt: new Date(), downloadExpiresAt: new Date("2027-02-22T00:00:00Z") } : {}),
      ...(input.provider ? {
        payments: {
          create: {
            provider: input.provider,
            mode: "TEST",
            status: "SUCCEEDED",
            amountCents: input.amountCents ?? 9_000,
            currency: "EUR",
            pricingVersion: "2026-08-v1",
            idempotencyKey: `v076-payment:${input.orderNumber}`,
            providerCheckoutId: `${input.provider.toLowerCase()}-checkout-${input.orderNumber}`,
            providerPaymentId: input.providerPaymentId,
            paymentMethod: input.provider === "PAYPAL" ? "PAYPAL" : "CARD",
            paidAt: new Date("2026-08-22T10:00:00Z"),
          },
        },
      } : {}),
    },
    include: { payments: true },
  });
  if (input.provider && input.issueInvoice !== false) {
    await prisma.$transaction((transaction) => issueInvoiceForPayment(transaction, order.payments[0]!.id));
  }
  return order;
}

function fakeDependencies() {
  const repository = createRefundDatabaseRepository(prisma);
  const calls: Array<{ provider: "STRIPE" | "PAYPAL"; idempotencyKey: string; amountCents: number }> = [];
  const evidence = new Map<string, RefundProviderEvidence>();
  let failNext = false;
  const dependencies: RefundDependencies = {
    repository,
    assertRuntime: async () => ({ mode: "TEST", liveRefundsEnabled: false }),
    gateway(provider) {
      return {
        async request(input) {
          calls.push({ provider, idempotencyKey: input.idempotencyKey, amountCents: input.amountCents });
          if (failNext) {
            failNext = false;
            throw new PaypalClientError("UNAVAILABLE");
          }
          const value = {
            provider,
            providerRefundId: `${provider.toLowerCase()}-refund-${input.attemptId}`,
            providerPaymentId: input.providerPaymentId,
            status: "SUCCEEDED" as const,
            amountCents: input.amountCents,
            currency: "EUR" as const,
            occurredAt: new Date(),
          };
          evidence.set(value.providerRefundId, value);
          return value;
        },
        async retrieve(providerRefundId) {
          const value = evidence.get(providerRefundId);
          if (!value) throw new PaypalClientError("UNAVAILABLE");
          return value;
        },
      };
    },
  };
  return { dependencies, repository, calls, failOnce: () => { failNext = true; } };
}

async function run() {
  assert.equal(await assertRefundQaDatabase(), REFUND_QA_TARGET);
  await assertClean("precondition");
  const passed: string[] = [];
  const [admin, member] = await Promise.all([
    prisma.user.create({ data: { email: QA_EMAILS[0], displayName: "Refund Admin QA", emailVerified: true, emailVerifiedAt: new Date(), role: "ADMIN", status: "ACTIVE" } }),
    prisma.user.create({ data: { email: QA_EMAILS[1], displayName: "Refund Member QA", emailVerified: true, emailVerifiedAt: new Date(), role: "MEMBER", status: "ACTIVE" } }),
  ]);
    const actor = { id: admin.id, email: admin.email, name: admin.displayName, role: "ADMIN", status: "ACTIVE", emailVerified: true } satisfies OrderActor;
    const memberActor = { id: member.id, email: member.email, name: member.displayName, role: "MEMBER", status: "ACTIVE", emailVerified: true } satisfies OrderActor;
    const fixture = fakeDependencies();

    for (const [index, provider] of (["STRIPE", "PAYPAL"] as const).entries()) {
      const withoutInvoice = await createOrderPayment({
        orderNumber: QA_ORDERS[5 + index]!, userId: member.id, customerEmail: member.email,
        orderStatus: "IN_PROGRESS", provider, issueInvoice: false,
        providerPaymentId: provider === "STRIPE" ? "pi_v076_without_invoice" : "PAYPAL-CAPTURE-V076-WITHOUT-INVOICE",
      });
      const callsBefore = fixture.calls.length;
      await assert.rejects(
        requestRefundForOrder(actor, {
          orderNumber: withoutInvoice.orderNumber,
          kind: "FULL",
          requestToken: `${index + 6}0000000-0000-4000-8000-000000000001`,
        }, fixture.dependencies),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "REFUND_SOURCE_INVOICE_REQUIRED",
      );
      assert.equal(fixture.calls.length, callsBefore);
      assert.equal(await prisma.refundAttempt.count({ where: { paymentId: withoutInvoice.payments[0]!.id } }), 0);
    }
    passed.push("missing Commander invoice blocks Stripe and PayPal before RefundAttempt and provider mutation");

    const inProgress = await createOrderPayment({ orderNumber: QA_ORDERS[0], userId: member.id, customerEmail: member.email, orderStatus: "IN_PROGRESS", provider: "STRIPE", providerPaymentId: "pi_v076_in_progress" });
    const payment = inProgress.payments[0]!;
    await requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 2_000, requestToken: "10000000-0000-4000-8000-000000000001" }, fixture.dependencies);
    const [partialPayment, partialOrder, partialEvents] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: inProgress.id } }),
      prisma.orderEvent.findMany({ where: { orderId: inProgress.id }, orderBy: { createdAt: "asc" } }),
    ]);
    assert.equal(partialPayment.status, "PARTIALLY_REFUNDED");
    assert.equal(partialPayment.refundedAmountCents, 2_000);
    assert.equal(partialOrder.status, "IN_PROGRESS");
    assert.ok(partialEvents.every((event) => event.fromStatus === null && event.toStatus === "IN_PROGRESS"));
    assert.equal(await prisma.orderNotification.count({ where: { orderId: inProgress.id, kind: "CUSTOMER_PARTIAL_REFUND" } }), 1);
    passed.push("partial refund keeps IN_PROGRESS and writes NULL -> IN_PROGRESS annotations");

    const firstAttempt = await prisma.refundAttempt.findUniqueOrThrow({
      where: { localIdempotencyKey: "refund-request:10000000-0000-4000-8000-000000000001" },
    });
    const webhookAfterApi = {
      id: `${EVENT_PREFIX}stripe_refund_after_api`, type: "refund.updated", livemode: false, created: Math.floor(Date.now() / 1_000),
      data: { object: { id: firstAttempt.providerRefundId, object: "refund", payment_intent: "pi_v076_in_progress", amount: 2_000, currency: "eur", status: "succeeded" } },
    } as const;
    assert.equal((await processVerifiedStripeFinancialEvent(webhookAfterApi)).outcome, "PROCESSED");
    assert.equal(await prisma.orderNotification.count({ where: { orderId: inProgress.id, kind: "CUSTOMER_PARTIAL_REFUND" } }), 1);
    passed.push("webhook after API completion records one receipt without duplicate notification");

    const callsBeforeReplay = fixture.calls.length;
    await requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 2_000, requestToken: "10000000-0000-4000-8000-000000000001" }, fixture.dependencies);
    assert.equal(fixture.calls.length, callsBeforeReplay);
    assert.equal(await prisma.refundAttempt.count({ where: { paymentId: payment.id } }), 1);
    passed.push("double click reuses one logical RefundAttempt without a provider replay");

    fixture.failOnce();
    const callsBeforeAmbiguous = fixture.calls.length;
    await assert.rejects(requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 1_000, requestToken: "10000000-0000-4000-8000-000000000002" }, fixture.dependencies));
    const timedOut = await prisma.refundAttempt.findUniqueOrThrow({ where: { localIdempotencyKey: "refund-request:10000000-0000-4000-8000-000000000002" } });
    assert.equal(timedOut.status, "REQUIRES_REVIEW");
    const duplicate = await requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 1_000, requestToken: "10000000-0000-4000-8000-000000000002" }, fixture.dependencies);
    assert.equal(duplicate.status, "REQUIRES_REVIEW");
    assert.equal(fixture.calls.length, callsBeforeAmbiguous + 1);
    const reconciliation = await reconcileRefundAttemptForAdmin(actor, timedOut.id, fixture.dependencies);
    assert.equal(reconciliation.status, "REQUIRES_REVIEW");
    const preserved = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: timedOut.id } });
    assert.equal(preserved.status, "REQUIRES_REVIEW");
    assert.equal(fixture.calls.length, callsBeforeAmbiguous + 1);
    const reconciliationAudit = await prisma.paymentAuditEvent.findFirstOrThrow({
      where: { refundAttemptId: timedOut.id, action: "RECONCILIATION_CHECKED" },
    });
    assert.equal(reconciliationAudit.actorUserId, admin.id);
    assert.equal(reconciliationAudit.actorRole, "ADMIN");
    passed.push("timeout without provider id remains in review without a blind provider retry");

    await assert.rejects(requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 7_000, requestToken: "10000000-0000-4000-8000-000000000003" }, fixture.dependencies));
    await assert.rejects(requestRefundForOrder(memberActor, { orderNumber: inProgress.orderNumber, kind: "FULL", requestToken: "10000000-0000-4000-8000-000000000004" }, fixture.dependencies));
    passed.push("over-refund and MEMBER access are refused before provider mutation");

    const concurrent = await Promise.allSettled([
      requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 4_000, requestToken: "10000000-0000-4000-8000-000000000006" }, fixture.dependencies),
      requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "PARTIAL", amountCents: 4_000, requestToken: "10000000-0000-4000-8000-000000000007" }, fixture.dependencies),
    ]);
    assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
    const afterConcurrent = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const activeAfterConcurrent = await prisma.refundAttempt.aggregate({
      where: { paymentId: payment.id, status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] } },
      _sum: { amountCents: true },
    });
    assert.equal(afterConcurrent.refundedAmountCents, 6_000);
    assert.equal(activeAfterConcurrent._sum.amountCents, 1_000);
    assert.equal((await prisma.refundAttempt.findUniqueOrThrow({ where: { id: timedOut.id } })).status, "REQUIRES_REVIEW");
    assert.equal(refundableAmount({
      paidCents: afterConcurrent.amountCents,
      confirmedRefundedCents: afterConcurrent.refundedAmountCents,
      reservedRefundCents: activeAfterConcurrent._sum.amountCents ?? 0,
    }), 2_000);
    passed.push("concurrent partial refunds serialize while REQUIRES_REVIEW stays reserved but unconfirmed");

    await requestRefundForOrder(actor, { orderNumber: inProgress.orderNumber, kind: "FULL", requestToken: "10000000-0000-4000-8000-000000000005" }, fixture.dependencies);
    const [partiallyRefundedWithReview, stillInProgress] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: inProgress.id } }),
    ]);
    assert.equal(partiallyRefundedWithReview.status, "REFUND_PENDING");
    assert.equal(partiallyRefundedWithReview.refundedAmountCents, 8_000);
    assert.equal(stillInProgress.status, "IN_PROGRESS");
    assert.equal(await prisma.orderNotification.count({ where: { orderId: inProgress.id, kind: "CUSTOMER_REFUND_COMPLETED" } }), 0);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: inProgress.id, kind: "CUSTOMER_PARTIAL_REFUND" } }), 3);
    passed.push("FULL refunds only unreserved capacity while an ambiguous amount remains protected");

    await assert.rejects(prisma.orderEvent.create({
      data: {
        orderId: inProgress.id, fromStatus: "IN_PROGRESS", toStatus: "IN_PROGRESS",
        visibility: "INTERNAL", note: "Fausse transition de remboursement interdite.",
      },
    }));
    assert.ok((await prisma.orderEvent.count({
      where: { orderId: inProgress.id, fromStatus: null, toStatus: "IN_PROGRESS" },
    })) >= 1);
    passed.push("PostgreSQL refuses false Order transitions and accepts refund annotations");

    const delivered = await createOrderPayment({ orderNumber: QA_ORDERS[1], userId: member.id, customerEmail: member.email, orderStatus: "DELIVERED", provider: "PAYPAL", amountCents: 5_000, providerPaymentId: "PAYPAL-CAPTURE-V076-DELIVERED" });
    await requestRefundForOrder(actor, { orderNumber: delivered.orderNumber, kind: "FULL", requestToken: "20000000-0000-4000-8000-000000000001" }, fixture.dependencies);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: delivered.payments[0]!.id } })).status, "REFUNDED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: delivered.id } })).status, "DELIVERED");
    passed.push("PayPal full refund keeps DELIVERED immutable");

    const unpaid = await createOrderPayment({ orderNumber: QA_ORDERS[2], userId: member.id, customerEmail: member.email, orderStatus: "AWAITING_PAYMENT" });
    await assert.rejects(requestRefundForOrder(actor, { orderNumber: unpaid.orderNumber, kind: "FULL", requestToken: "30000000-0000-4000-8000-000000000001" }, fixture.dependencies));
    passed.push("DRAFT/AWAITING_PAYMENT without a winning Payment is not refundable");

    const webhookOrder = await createOrderPayment({ orderNumber: QA_ORDERS[3], userId: member.id, customerEmail: member.email, orderStatus: "IN_PROGRESS", provider: "STRIPE", amountCents: 5_000, providerPaymentId: "pi_v076_webhook" });
    const reservedWebhook = await fixture.repository.reserve({ actor, orderNumber: webhookOrder.orderNumber, kind: "PARTIAL", amountCents: 1_000, localIdempotencyKey: "refund-request:40000000-0000-4000-8000-000000000001" });
    const stripeEvent = {
      id: `${EVENT_PREFIX}stripe_refund_created`, type: "refund.created", livemode: false, created: Math.floor(Date.now() / 1_000),
      data: { object: { id: "re_v076_webhook", object: "refund", payment_intent: "pi_v076_webhook", amount: 1_000, currency: "eur", status: "succeeded" } },
    } as const;
    const webhookResults = [await processVerifiedStripeFinancialEvent(stripeEvent), await processVerifiedStripeFinancialEvent(stripeEvent)];
    assert.deepEqual(webhookResults.map(({ duplicate }) => duplicate).sort(), [false, true]);
    const webhookAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: reservedWebhook.id } });
    assert.equal(webhookAttempt.providerRefundId, "re_v076_webhook");
    assert.equal(webhookAttempt.status, "SUCCEEDED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: webhookOrder.id } })).status, "IN_PROGRESS");
    assert.equal(await prisma.orderNotification.count({ where: { orderId: webhookOrder.id, kind: "CUSTOMER_PARTIAL_REFUND" } }), 1);
    passed.push("webhook before API response binds the reserved attempt and replay is idempotent");

    const paypalIncidentOrder = await createOrderPayment({ orderNumber: QA_ORDERS[4], userId: member.id, customerEmail: member.email, orderStatus: "DELIVERED", provider: "PAYPAL", amountCents: 5_000, providerPaymentId: "PAYPAL-CAPTURE-V076-INCIDENT" });
    const dispute = {
      id: `${EVENT_PREFIX}paypal_dispute_created`, event_type: "CUSTOMER.DISPUTE.CREATED", create_time: new Date().toISOString(),
      resource: {
        dispute_id: "PP-D-V076-01", status: "OPEN", dispute_life_cycle_stage: "INQUIRY",
        dispute_amount: { currency_code: "EUR", value: "50.00" },
        disputed_transactions: [{ seller_transaction_id: "PAYPAL-CAPTURE-V076-INCIDENT" }],
      },
    } as const;
    const disputeResults = [await processVerifiedPaypalFinancialEvent(dispute), await processVerifiedPaypalFinancialEvent(dispute)];
    assert.deepEqual(disputeResults.map(({ duplicate }) => duplicate).sort(), [false, true]);
    assert.equal(await prisma.paymentIncident.count({ where: { paymentId: paypalIncidentOrder.payments[0]!.id, type: "DISPUTE" } }), 1);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: paypalIncidentOrder.id } })).status, "DELIVERED");
    const reversal = {
      id: `${EVENT_PREFIX}paypal_reversal`, event_type: "PAYMENT.CAPTURE.REVERSED", create_time: new Date().toISOString(),
      resource: { id: "PAYPAL-CAPTURE-V076-INCIDENT", amount: { currency_code: "EUR", value: "50.00" } },
    } as const;
    await processVerifiedPaypalFinancialEvent(reversal);
    assert.equal(await prisma.paymentIncident.count({ where: { paymentId: paypalIncidentOrder.payments[0]!.id, type: "REVERSAL" } }), 1);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: paypalIncidentOrder.payments[0]!.id } })).status, "SUCCEEDED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: paypalIncidentOrder.id } })).status, "DELIVERED");
    passed.push("PayPal dispute and reversal are separate incidents and never mutate Payment winner or Order");

    await assert.rejects(prisma.payment.create({
      data: {
        orderId: inProgress.id, provider: "PAYPAL", mode: "TEST", status: "SUCCEEDED", amountCents: 9_000,
        currency: "EUR", pricingVersion: "2026-08-v1", idempotencyKey: "v076-second-provider-forbidden",
        providerCheckoutId: "PAYPAL-SECOND-CHECKOUT", providerPaymentId: "PAYPAL-SECOND-CAPTURE", paymentMethod: "PAYPAL", paidAt: new Date(),
      },
    }));
    passed.push("the existing financial winner still prevents a second provider winner while refund review is open");

    const rollbackBefore = await prisma.refundAttempt.count({ where: { paymentId: delivered.payments[0]!.id } });
    await assert.rejects(prisma.$transaction(async (transaction) => {
      await transaction.refundAttempt.create({
        data: {
          paymentId: delivered.payments[0]!.id, provider: "PAYPAL", source: "PROVIDER", amountCents: 100,
          currency: "EUR", localIdempotencyKey: "provider-event:paypal:rollback-v076",
          providerIdempotencyKey: "provider-refund:paypal:rollback-v076", status: "PROCESSING",
        },
      });
      throw new Error("forced rollback");
    }));
    assert.equal(await prisma.refundAttempt.count({ where: { paymentId: delivered.payments[0]!.id } }), rollbackBefore);
    const issuedCreditNote = await prisma.creditNote.findFirstOrThrow({
      where: { invoice: { paymentId: payment.id } },
      select: { id: true },
    });
    await assert.rejects(prisma.creditNote.delete({ where: { id: issuedCreditNote.id } }));
    assert.equal(await prisma.creditNote.count({ where: { id: issuedCreditNote.id } }), 1);
    passed.push("forced DB failure rolls back atomically and issued credit notes remain immutable");

  console.info(`V0.7.6 refund runtime passed (${passed.length} groups):`);
  for (const label of passed) console.info(`- ${label}`);
  console.info("Refund runtime fixtures are retained only inside the disposable Prisma Dev instance for instance-level teardown.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Refund runtime validation failed.");
    process.exitCode = 1;
  });

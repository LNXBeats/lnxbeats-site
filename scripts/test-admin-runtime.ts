import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

import {
  addInternalOrderNote,
  deleteEligibleAdminOrder,
  getAdminOrder,
  getDatabaseCatalogueAudit,
  listAdminMembers,
  listAdminOrders,
  transitionOrderStatus,
} from "@/lib/admin/service";
import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { canAccessAdmin } from "@/lib/auth/roles";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { addOrderPhotos, createDraftOrder, finalizeOrder, getOrderForActor } from "@/lib/orders/service";
import { clearQaOrderStorage, readPrivateOrderFile } from "@/lib/orders/storage";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v060-test";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v060-test/server.json";
const MEMBER_EMAIL = "lnx-v060-admin-suite-member@example.invalid";
const ADMIN_EMAIL = "lnx-v060-admin-suite-owner@example.invalid";

const input: OrderDraftInput = {
  title: "Cockpit Admin QA",
  recipient: "Personne fictive",
  occasion: "Validation jetable",
  brief: "Cette histoire fictive valide le cockpit administrateur sans contenir aucune donnée réelle.",
  musicalDirection: "Cinématographique",
  emotion: "Sincère",
  importantDetails: "",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  illustrationFormat: "SQUARE",
  illustrationFormatCustom: "",
  coverIncluded: true,
  priorityProcessing: false,
};

async function guards() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE);
  assert.equal(process.env.ORDER_UPLOAD_MODE, "local-qa");
  assert.ok(process.env.DATABASE_URL);
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.ok(url.port && url.port !== "5432");
  const proof = JSON.parse(await readFile(EXPECTED_SERVER_FILE, "utf8")) as { name?: string; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, EXPECTED_TARGET);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.paymentAuditEvent.deleteMany();
    await transaction.providerEvent.deleteMany();
    await transaction.paymentIncident.deleteMany();
    await transaction.refundAttempt.deleteMany();
    await transaction.payment.deleteMany();
    await transaction.orderNotification.deleteMany();
    await transaction.orderAsset.deleteMany();
    await transaction.commercialLicense.deleteMany();
    await transaction.orderEvent.deleteMany();
    await transaction.order.deleteMany();
    await transaction.asset.deleteMany();
    await transaction.customer.deleteMany();
    await transaction.rateLimit.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
  await clearQaOrderStorage();
}

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

async function run() {
  await guards();
  await cleanup();
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;
  const passed: string[] = [];
  try {
    const memberUser = await createInternalAuthUser({ email: MEMBER_EMAIL, password, displayName: "Member Admin QA", role: "MEMBER" });
    const adminUser = await createInternalAuthUser({ email: ADMIN_EMAIL, password, displayName: "Owner Admin QA", role: "ADMIN" });
    const member = actor(memberUser);

    assert.equal(canAccessAdmin(undefined), false);
    assert.equal(canAccessAdmin(memberUser.role), false);
    assert.equal(canAccessAdmin(adminUser.role), true);
    passed.push("visitor and MEMBER refused, ADMIN authorized");

    const draft = await createDraftOrder(member, input);
    await finalizeOrder(member, draft.orderNumber, input, {
      personalUseTermsAccepted: true,
      earlyPerformanceConsentAccepted: true,
    });
    const listed = await listAdminOrders("all");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.orderNumber, draft.orderNumber);
    assert.equal((await getAdminOrder(draft.orderNumber))?.customerEmail, MEMBER_EMAIL);
    passed.push("real order list and detail");

    await assert.rejects(transitionOrderStatus(draft.orderNumber, "DELIVERED", adminUser.id));
    await assert.rejects(transitionOrderStatus(draft.orderNumber, "RECEIVED", adminUser.id));
    const paymentOrder = await prisma.order.findUniqueOrThrow({ where: { orderNumber: draft.orderNumber } });
    const paidAt = new Date();
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId: paymentOrder.id,
          provider: "STRIPE",
          mode: "TEST",
          status: "SUCCEEDED",
          amountCents: paymentOrder.totalCents,
          currency: paymentOrder.currency,
          pricingVersion: paymentOrder.pricingVersion,
          idempotencyKey: `admin-runtime-success:${paymentOrder.id}`,
          paidAt,
        },
      }),
      prisma.order.update({ where: { id: paymentOrder.id }, data: { status: "PAYMENT_CONFIRMED" } }),
      prisma.orderEvent.create({ data: { orderId: paymentOrder.id, fromStatus: "AWAITING_PAYMENT", toStatus: "PAYMENT_CONFIRMED", note: "Paiement Stripe Test confirmé par la fixture runtime.", visibility: "CLIENT" } }),
    ]);
    assert.equal((await listAdminOrders("attention")).some(({ orderNumber }) => orderNumber === draft.orderNumber), true);
    assert.equal(await transitionOrderStatus(draft.orderNumber, "RECEIVED", adminUser.id), "RECEIVED");
    assert.equal(await transitionOrderStatus(draft.orderNumber, "REVIEWING", adminUser.id), "REVIEWING");
    const competingTransitions = await Promise.allSettled([
      transitionOrderStatus(draft.orderNumber, "ACCEPTED", adminUser.id),
      transitionOrderStatus(draft.orderNumber, "ACCEPTED", adminUser.id),
    ]);
    assert.equal(competingTransitions.filter(({ status }) => status === "fulfilled").length, 1);
    const transitioned = await getAdminOrder(draft.orderNumber);
    assert.equal(transitioned?.status, "ACCEPTED");
    assert.equal(transitioned?.events.filter(({ toStatus }) => toStatus === "ACCEPTED").length, 1);
    await assert.rejects(deleteEligibleAdminOrder(draft.orderNumber));
    passed.push("unpaid bypass refused, paid order highlighted, valid and concurrent transitions protected");

    const protectedDraft = await createDraftOrder(member, { ...input, title: "Conservation paiement Admin QA" });
    await finalizeOrder(member, protectedDraft.orderNumber, input, {
      personalUseTermsAccepted: true,
      earlyPerformanceConsentAccepted: true,
    });
    const protectedOrder = await prisma.order.findUniqueOrThrow({ where: { orderNumber: protectedDraft.orderNumber } });
    await prisma.payment.create({
      data: {
        orderId: protectedOrder.id,
        provider: "STRIPE",
        mode: "TEST",
        status: "PENDING",
        amountCents: protectedOrder.totalCents,
        currency: protectedOrder.currency,
        pricingVersion: protectedOrder.pricingVersion,
        idempotencyKey: `admin-runtime-pending:${protectedOrder.id}`,
      },
    });
    assert.equal(await transitionOrderStatus(protectedDraft.orderNumber, "CANCELLED", adminUser.id), "CANCELLED");
    await assert.rejects(deleteEligibleAdminOrder(protectedDraft.orderNumber));
    passed.push("any payment attempt blocks destructive Admin deletion");

    const removableDraft = await createDraftOrder(member, { ...input, title: "Suppression Admin QA" });
    const photoBuffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#6b5634" } }).jpeg().toBuffer();
    const removableWithPhoto = await addOrderPhotos(member, removableDraft.orderNumber, [{ buffer: photoBuffer, originalFilename: "admin-delete.jpg", declaredMimeType: "image/jpeg" }]);
    const removableAsset = await prisma.asset.findUniqueOrThrow({ where: { id: removableWithPhoto.photos[0]!.id } });
    await finalizeOrder(member, removableDraft.orderNumber, input, {
      personalUseTermsAccepted: true,
      earlyPerformanceConsentAccepted: true,
    });
    assert.equal(await transitionOrderStatus(removableDraft.orderNumber, "CANCELLED", adminUser.id), "CANCELLED");
    const removableOrderId = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: removableDraft.orderNumber }, select: { id: true } })).id;
    await deleteEligibleAdminOrder(removableDraft.orderNumber);
    assert.equal(await prisma.order.count({ where: { orderNumber: removableDraft.orderNumber } }), 0);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: removableOrderId } }), 0);
    assert.equal(await prisma.orderAsset.count({ where: { orderId: removableOrderId } }), 0);
    assert.equal(await prisma.asset.count({ where: { id: removableAsset.id } }), 0);
    await assert.rejects(readPrivateOrderFile(removableAsset.storageKey));
    passed.push("eligible cancelled order, timeline, asset relation and private file deleted without orphans");

    await addInternalOrderNote(draft.orderNumber, "Note réservée au cockpit.", adminUser.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: paymentOrder.id } });
    const refundedAt = new Date();
    const { refundAttempt, incident } = await prisma.$transaction(async (transaction) => {
      const createdRefundAttempt = await transaction.refundAttempt.create({
        data: {
          paymentId: payment.id,
          provider: "STRIPE",
          source: "ADMIN",
          amountCents: 1_000,
          currency: payment.currency,
          requestedByUserId: adminUser.id,
          localIdempotencyKey: `admin-runtime-refund-local:${payment.id}`,
          providerIdempotencyKey: `admin-runtime-refund-provider:${payment.id}`,
          providerRefundId: "re_admin_runtime_confirmed",
          status: "SUCCEEDED",
          attempts: 1,
          lastAttemptAt: refundedAt,
          confirmedAt: refundedAt,
        },
      });
      const createdIncident = await transaction.paymentIncident.create({
        data: {
          paymentId: payment.id,
          provider: "STRIPE",
          type: "DISPUTE",
          providerIncidentId: "dp_admin_runtime_open",
          status: "OPEN",
          amountCents: 1_500,
          currency: payment.currency,
          requiresOperatorReview: true,
          openedAt: refundedAt,
        },
      });
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: "PARTIALLY_REFUNDED",
          refundedAmountCents: createdRefundAttempt.amountCents,
          refundedAt,
        },
      });
      await transaction.paymentAuditEvent.createMany({
        data: [
          {
            paymentId: payment.id,
            refundAttemptId: createdRefundAttempt.id,
            actorUserId: adminUser.id,
            actorRole: "ADMIN",
            provider: "STRIPE",
            action: "REFUND_CONFIRMED",
            amountCents: createdRefundAttempt.amountCents,
            result: "SUCCEEDED",
            createdAt: refundedAt,
          },
          {
            paymentId: payment.id,
            incidentId: createdIncident.id,
            provider: "STRIPE",
            action: "INCIDENT_OPENED",
            amountCents: createdIncident.amountCents,
            result: "REQUIRES_REVIEW",
            createdAt: refundedAt,
          },
        ],
      });
      return { refundAttempt: createdRefundAttempt, incident: createdIncident };
    });
    const adminDetail = await getAdminOrder(draft.orderNumber);
    assert.equal(adminDetail?.events.some(({ visibility }) => visibility === "INTERNAL"), true);
    assert.equal(adminDetail?.payments.length, 1);
    assert.deepEqual(
      adminDetail?.notifications.map(({ kind, status, attempts }) => ({ kind, status, attempts })),
      [{ kind: "CUSTOMER_ORDER_ACCEPTED", status: "PENDING", attempts: 0 }],
    );
    assert.deepEqual(Object.keys(adminDetail?.payments[0] ?? {}).sort(), [
      "amountCents", "auditEvents", "createdAt", "currency", "events", "failureCode", "id", "incidents", "mode", "paymentMethod",
      "pricingVersion", "provider", "providerCheckoutId", "providerPaymentId", "refundAttempts", "refundedAmountCents", "refundedAt", "status", "updatedAt",
    ].sort());
    const adminPayment = adminDetail?.payments[0];
    assert.equal(adminPayment?.status, "PARTIALLY_REFUNDED");
    assert.equal(adminPayment?.refundedAmountCents, 1_000);
    assert.equal(adminPayment?.refundedAt?.toISOString(), refundedAt.toISOString());
    assert.equal(adminPayment?.refundAttempts.length, 1);
    assert.deepEqual(
      adminPayment?.refundAttempts.map(({ source, amountCents, currency, status, providerRefundId, failureCode, attempts, confirmedAt }) => ({
        source, amountCents, currency, status, providerRefundId, failureCode, attempts, confirmedAt: confirmedAt?.toISOString(),
      })),
      [{
        source: "ADMIN", amountCents: 1_000, currency: payment.currency, status: "SUCCEEDED",
        providerRefundId: refundAttempt.providerRefundId, failureCode: null, attempts: 1, confirmedAt: refundedAt.toISOString(),
      }],
    );
    assert.deepEqual(
      adminPayment?.incidents.map(({ type, providerIncidentId, status, amountCents, currency, outcome, requiresOperatorReview, openedAt, resolvedAt }) => ({
        type, providerIncidentId, status, amountCents, currency, outcome, requiresOperatorReview,
        openedAt: openedAt.toISOString(), resolvedAt: resolvedAt?.toISOString() ?? null,
      })),
      [{
        type: "DISPUTE", providerIncidentId: incident.providerIncidentId, status: "OPEN", amountCents: 1_500,
        currency: payment.currency, outcome: null, requiresOperatorReview: true, openedAt: refundedAt.toISOString(), resolvedAt: null,
      }],
    );
    assert.deepEqual(
      adminPayment?.auditEvents.map(({ action, amountCents, result, actorRole }) => ({ action, amountCents, result, actorRole }))
        .sort((left, right) => left.action.localeCompare(right.action)),
      [
        { action: "INCIDENT_OPENED", amountCents: 1_500, result: "REQUIRES_REVIEW", actorRole: null },
        { action: "REFUND_CONFIRMED", amountCents: 1_000, result: "SUCCEEDED", actorRole: "ADMIN" },
      ],
    );
    const adminPaymentPayload = JSON.stringify(adminPayment);
    for (const forbiddenKey of ["idempotencyKey", "localIdempotencyKey", "providerIdempotencyKey", "requestedByUserId", "rawPayload", "webhookSecret", "apiKey", "clientSecret", "accessToken", "refreshToken"]) {
      assert.equal(adminPaymentPayload.includes(`\"${forbiddenKey}\"`), false);
    }
    assert.equal(adminPaymentPayload.includes(`admin-runtime-refund-local:${payment.id}`), false);
    assert.equal(adminPaymentPayload.includes(`admin-runtime-refund-provider:${payment.id}`), false);
    const clientDetail = await getOrderForActor(member, draft.orderNumber);
    assert.equal(clientDetail?.events.some(({ note }) => note === "Note réservée au cockpit."), false);
    const memberPayment = clientDetail?.payments[0];
    assert.deepEqual(Object.keys(memberPayment ?? {}).sort(), [
      "amountCents", "checkoutExpiresAt", "createdAt", "currency", "expiredAt", "failedAt", "id", "paidAt", "paymentMethod", "provider", "status", "updatedAt",
    ].sort());
    const memberPaymentPayload = JSON.stringify(memberPayment);
    for (const adminOnlyField of ["refundedAmountCents", "refundedAt", "refundAttempts", "incidents", "auditEvents", "providerCheckoutId", "providerPaymentId", "providerRefundId", "providerIncidentId"]) {
      assert.equal(memberPaymentPayload.includes(`\"${adminOnlyField}\"`), false);
    }
    passed.push("V0.7.6 financial review exposed only to Admin, internal details hidden from MEMBER, and accepted notification visible in Admin outbox");

    const members = await listAdminMembers();
    assert.equal(members.length, 2);
    assert.deepEqual(Object.keys(members[0] ?? {}).sort(), ["createdAt", "displayName", "email", "emailVerified", "id", "role", "status"].sort());
    passed.push("member list excludes credentials, sessions and tokens");

    const projectsBefore = await prisma.project.count();
    await getDatabaseCatalogueAudit();
    assert.equal(await prisma.project.count(), projectsBefore);
    passed.push("catalogue audit is read-only");

    console.info(`Phase 3 admin runtime passed (${passed.length} groups):`);
    passed.forEach((label) => console.info(`- ${label}`));
  } finally {
    await cleanup();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Admin runtime validation failed.");
    process.exitCode = 1;
  });

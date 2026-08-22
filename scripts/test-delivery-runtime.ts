import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { transitionOrderStatus, AdminServiceError } from "@/lib/admin/service";
import { getOrderDeliveryForActor, OrderDeliveryError, removeOrderDelivery } from "@/lib/orders/delivery";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-studio-v075-test";
const DATABASE_PORT = "51254";
const PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v075-test/server.json";
const IDS = {
  admin: "00000000-0000-4000-8000-000000000501",
  member: "00000000-0000-4000-8000-000000000502",
  other: "00000000-0000-4000-8000-000000000503",
  paidOrder: "00000000-0000-4000-8000-000000000510",
  unpaidOrder: "00000000-0000-4000-8000-000000000511",
  payment: "00000000-0000-4000-8000-000000000520",
  audio: "00000000-0000-4000-8000-000000000530",
  archive: "00000000-0000-4000-8000-000000000531",
  unpaidAsset: "00000000-0000-4000-8000-000000000532",
} as const;
const EMAILS = ["v075-delivery-admin@example.invalid", "v075-delivery-member@example.invalid", "v075-delivery-other@example.invalid"];
const ORDER_NUMBERS = ["LNX-2075-900001", "LNX-2075-900002"];

type RuntimeProof = { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };

async function assertDisposableRuntime() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, PROOF_FILE);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT, "Railway is forbidden for the disposable delivery runtime.");
  assert.equal(process.env.EMAIL_NOTIFICATIONS_ENABLED, "false");
  assert.equal(process.env.CLIENT_EMAIL_NOTIFICATIONS_ENABLED, "false");
  assert.equal(process.env.OWNER_EMAIL_NOTIFICATIONS_ENABLED, "false");
  const rawDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(rawDatabaseUrl);
  const databaseUrl = new URL(rawDatabaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, DATABASE_PORT);
  assert.equal(decodeURIComponent(databaseUrl.pathname), "/template1");
  const proof = JSON.parse(await readFile(PROOF_FILE, "utf8")) as RuntimeProof;
  assert.equal(proof.name, TARGET);
  assert.equal(proof.exports?.database?.connectionString, rawDatabaseUrl);
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);
}

function actor(id: string, role: "ADMIN" | "MEMBER"): OrderActor {
  return { id, email: EMAILS[id === IDS.admin ? 0 : id === IDS.member ? 1 : 2]!, name: "Delivery QA", role, status: "ACTIVE", emailVerified: true };
}

async function assertFreshDatabase() {
  const counts = await Promise.all([
    prisma.user.count(), prisma.order.count(), prisma.payment.count(), prisma.providerEvent.count(),
    prisma.orderAsset.count(), prisma.asset.count(), prisma.orderEvent.count(), prisma.orderNotification.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), "The V0.7.5 disposable database is not fresh.");
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.notificationEvent.deleteMany({ where: { notification: { orderId: { in: [IDS.paidOrder, IDS.unpaidOrder] } } } });
    await transaction.orderNotification.deleteMany({ where: { orderId: { in: [IDS.paidOrder, IDS.unpaidOrder] } } });
    await transaction.providerEvent.deleteMany({ where: { paymentId: IDS.payment } });
    await transaction.orderAsset.deleteMany({ where: { orderId: { in: [IDS.paidOrder, IDS.unpaidOrder] } } });
    await transaction.payment.deleteMany({ where: { id: IDS.payment } });
    await transaction.orderEvent.deleteMany({ where: { orderId: { in: [IDS.paidOrder, IDS.unpaidOrder] } } });
    await transaction.order.deleteMany({ where: { id: { in: [IDS.paidOrder, IDS.unpaidOrder] } } });
    await transaction.asset.deleteMany({ where: { id: { in: [IDS.audio, IDS.archive, IDS.unpaidAsset] } } });
    await transaction.user.deleteMany({ where: { id: { in: [IDS.admin, IDS.member, IDS.other] } } });
  });
}

async function run() {
  await assertDisposableRuntime();
  await assertFreshDatabase();
  const passed: string[] = [];
  try {
    await prisma.user.createMany({ data: [
      { id: IDS.admin, email: EMAILS[0]!, displayName: "Delivery Admin QA", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() },
      { id: IDS.member, email: EMAILS[1]!, displayName: "Delivery Member QA", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() },
      { id: IDS.other, email: EMAILS[2]!, displayName: "Delivery Other QA", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() },
    ] });
    const orderData = (id: string, orderNumber: string) => ({
      id, orderNumber, userId: IDS.member, customerEmail: EMAILS[1]!, customerName: "Delivery Member QA",
      status: "PAYMENT_CONFIRMED" as const, title: "Livraison V0.7.5 jetable", brief: "Fixture locale jetable sans donnée personnelle.",
      musicalDirection: "Instrumental", totalCents: 5_000, basePriceCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1",
      submittedAt: new Date(), personalUseTermsVersion: "qa-v075", personalUseTermsHashSha256: "a".repeat(64), personalUseTermsAcceptedAt: new Date(),
    });
    await prisma.order.createMany({ data: [orderData(IDS.paidOrder, ORDER_NUMBERS[0]!), orderData(IDS.unpaidOrder, ORDER_NUMBERS[1]!)] });
    await prisma.payment.create({ data: {
      id: IDS.payment, orderId: IDS.paidOrder, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED",
      amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1", idempotencyKey: "v075-delivery-runtime-payment", paidAt: new Date(),
    } });
    await prisma.asset.createMany({ data: [
      { id: IDS.audio, type: "AUDIO", storageKey: `orders/${IDS.paidOrder}/deliveries/${IDS.audio}.wav`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", filename: "master.wav", mimeType: "audio/wav", sizeBytes: 1024n, durationMs: 10_000, rightsStatus: "CLEARED", confidence: "CONFIRMED" },
      { id: IDS.archive, type: "DOCUMENT", storageKey: `orders/${IDS.paidOrder}/deliveries/${IDS.archive}.zip`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", filename: "sources.zip", mimeType: "application/zip", sizeBytes: 2048n, rightsStatus: "CLEARED", confidence: "CONFIRMED" },
      { id: IDS.unpaidAsset, type: "DOCUMENT", storageKey: `orders/${IDS.unpaidOrder}/deliveries/${IDS.unpaidAsset}.pdf`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", filename: "notice.pdf", mimeType: "application/pdf", sizeBytes: 512n, rightsStatus: "CLEARED", confidence: "CONFIRMED" },
    ] });
    await prisma.orderAsset.createMany({ data: [
      { orderId: IDS.paidOrder, assetId: IDS.audio, role: "DELIVERY", position: 0 },
      { orderId: IDS.paidOrder, assetId: IDS.archive, role: "DELIVERY", position: 1 },
      { orderId: IDS.unpaidOrder, assetId: IDS.unpaidAsset, role: "DELIVERY", position: 0 },
    ] });

    await assert.rejects(transitionOrderStatus(ORDER_NUMBERS[1]!, "RECEIVED", IDS.admin), (error: unknown) => error instanceof AdminServiceError && error.code === "PAYMENT_REQUIRED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: IDS.unpaidOrder } })).status, "PAYMENT_CONFIRMED");
    passed.push("unpaid fulfillment refused without mutation");

    for (const target of ["RECEIVED", "REVIEWING", "ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY", "FINALIZING"] as const) {
      assert.equal(await transitionOrderStatus(ORDER_NUMBERS[0]!, target, IDS.admin), target);
    }
    assert.equal(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, IDS.audio), null);
    assert.ok(await getOrderDeliveryForActor(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, IDS.audio));
    passed.push("paid closed workflow and unpublished owner access gate");

    const doubleDelivery = await Promise.all([
      transitionOrderStatus(ORDER_NUMBERS[0]!, "DELIVERED", IDS.admin),
      transitionOrderStatus(ORDER_NUMBERS[0]!, "DELIVERED", IDS.admin),
    ]);
    assert.deepEqual(doubleDelivery, ["DELIVERED", "DELIVERED"]);
    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: IDS.paidOrder } });
    assert.equal(delivered.status, "DELIVERED");
    assert.ok(delivered.deliveredAt && delivered.downloadExpiresAt);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: IDS.paidOrder, toStatus: "DELIVERED" } }), 1);
    const notifications = await prisma.orderNotification.findMany({ where: { orderId: IDS.paidOrder, kind: "CUSTOMER_DELIVERY_READY" } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.status, "PENDING");
    assert.equal(notifications[0]?.attempts, 0);
    assert.equal(notifications[0]?.providerMessageId, null);
    passed.push("concurrent publish idempotence, one event and one queued notification");

    assert.ok(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, IDS.audio));
    assert.ok(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, IDS.archive));
    assert.ok(await getOrderDeliveryForActor(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, IDS.archive));
    assert.equal(await getOrderDeliveryForActor(actor(IDS.other, "MEMBER"), ORDER_NUMBERS[0]!, IDS.audio), null);
    assert.equal(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[1]!, IDS.audio), null);
    await assert.rejects(removeOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, IDS.audio), (error: unknown) => error instanceof OrderDeliveryError && error.code === "ORDER_NOT_DELIVERABLE");
    assert.equal(await prisma.orderAsset.count({ where: { orderId: IDS.paidOrder, role: "DELIVERY" } }), 2);
    passed.push("owner/admin multi-file access and cross-order IDOR refusal");

    console.info(`V0.7.5 delivery runtime passed (${passed.length} groups).`);
  } finally {
    await cleanup();
    await assertFreshDatabase();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Delivery runtime validation failed.");
    process.exitCode = 1;
  });

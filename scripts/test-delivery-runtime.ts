import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { transitionOrderStatus, AdminServiceError } from "@/lib/admin/service";
import type { OrderDeliveryUpload } from "@/lib/orders/audio-request";
import {
  getOrderDeliveryForActor,
  OrderDeliveryError,
  OrderDeliveryProcessingError,
  putOrderDelivery,
  removeOrderDelivery,
  type OrderDeliveryDependencies,
  type OrderDeliveryRemovalDependencies,
} from "@/lib/orders/delivery";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";

const TARGET = "lnx-studio-v075-test";
const DATABASE_PORT = "51254";
const PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v075-test/server.json";
const IDS = {
  admin: "00000000-0000-4000-8000-000000000501",
  member: "00000000-0000-4000-8000-000000000502",
  other: "00000000-0000-4000-8000-000000000503",
  missingAdmin: "00000000-0000-4000-8000-000000000504",
  paidOrder: "00000000-0000-4000-8000-000000000510",
  unpaidOrder: "00000000-0000-4000-8000-000000000511",
  payment: "00000000-0000-4000-8000-000000000520",
} as const;
const EMAILS = ["v075-delivery-admin@example.invalid", "v075-delivery-member@example.invalid", "v075-delivery-other@example.invalid"];
const ORDER_NUMBERS = ["LNX-2075-900001", "LNX-2075-900002"];
const ADDITION_NOTE_PREFIX = "Livrable privé ajouté par l’administration";
const REMOVAL_NOTE = "Livrable privé retiré avant publication par l’administration.";

type RuntimeProof = { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };
type ErrorRecord = Record<string, unknown>;

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

function source(input: {
  filename: string;
  extension: "wav" | "zip" | "pdf";
  assetType: "AUDIO" | "DOCUMENT";
  mimeType: "audio/wav" | "application/zip" | "application/pdf";
  sizeBytes: number;
  checksumCharacter: string;
}): OrderDeliveryUpload {
  return {
    path: "/private/tmp/not-read-by-delivery-runtime",
    originalFilename: input.filename,
    assetType: input.assetType,
    mimeType: input.mimeType,
    extension: input.extension,
    sizeBytes: input.sizeBytes,
    durationMs: input.assetType === "AUDIO" ? 10_000 : null,
    width: null,
    height: null,
    checksumSha256: input.checksumCharacter.repeat(64),
    cleanup: async () => undefined,
  };
}

function record(value: unknown): ErrorRecord | null {
  return value && typeof value === "object" ? value as ErrorRecord : null;
}

function databaseFailure(error: unknown) {
  const original = error instanceof OrderDeliveryProcessingError ? error.originalError : error;
  const outer = record(original);
  const meta = record(outer?.meta);
  const adapter = record(meta?.driverAdapterError);
  const cause = record(adapter?.cause);
  const message = [cause?.message, cause?.originalMessage, outer?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return {
    prismaCode: typeof outer?.code === "string" ? outer.code : null,
    sqlState: typeof cause?.originalCode === "string"
      ? cause.originalCode
      : typeof cause?.code === "string"
        ? cause.code
        : null,
    modelName: typeof meta?.modelName === "string" ? meta.modelName : null,
    constraintName: ["order_events_status_changes", "order_events_actorUserId_fkey"]
      .find((candidate) => message.includes(candidate)) ?? null,
  };
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
    await transaction.asset.deleteMany({
      where: {
        OR: [
          { storageKey: { startsWith: `orders/${IDS.paidOrder}/deliveries/` } },
          { storageKey: { startsWith: `orders/${IDS.unpaidOrder}/deliveries/` } },
        ],
      },
    });
    await transaction.user.deleteMany({ where: { id: { in: [IDS.admin, IDS.member, IDS.other] } } });
  });
}

async function run() {
  await assertDisposableRuntime();
  await assertFreshDatabase();
  const passed: string[] = [];
  const storedObjects = new Set<string>();
  const deletedObjects: string[] = [];
  const simulateWrite: OrderDeliveryDependencies["write"] = async ({ storageKey, source: upload }) => {
    storedObjects.add(storageKey);
    return {
      storageKey,
      storageBackend: "OBJECT",
      storageProvider: "r2",
      visibility: "PRIVATE",
      checksumSha256: upload.checksumSha256,
    };
  };
  const simulateDelete: OrderDeliveryDependencies["delete"] = async (reference) => {
    assert.equal(storedObjects.delete(reference.storageKey), true);
    deletedObjects.push(reference.storageKey);
  };
  const simulatedStorageOverrides: Partial<OrderDeliveryDependencies> = {
    validateStorage: () => ({ backend: "OBJECT", provider: "r2" }),
    write: simulateWrite,
    delete: simulateDelete,
  };
  const simulatedRemovalOverrides: Partial<OrderDeliveryRemovalDependencies> = { delete: simulateDelete };

  try {
    const migrationState = await prisma.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"
    `;
    assert.deepEqual(migrationState, [{ total: 16, applied: 16 }]);

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

    await assert.rejects(transitionOrderStatus(ORDER_NUMBERS[1]!, "RECEIVED", IDS.admin), (error: unknown) => error instanceof AdminServiceError && error.code === "PAYMENT_REQUIRED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: IDS.unpaidOrder } })).status, "PAYMENT_CONFIRMED");
    passed.push("unpaid fulfillment refused without mutation");

    for (const target of ["RECEIVED", "REVIEWING", "ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY", "FINALIZING"] as const) {
      assert.equal(await transitionOrderStatus(ORDER_NUMBERS[0]!, target, IDS.admin), target);
    }
    const eventCountBeforeConstraintProof = await prisma.orderEvent.count({ where: { orderId: IDS.paidOrder } });
    await assert.rejects(
      prisma.orderEvent.create({ data: {
        orderId: IDS.paidOrder,
        fromStatus: "FINALIZING",
        toStatus: "FINALIZING",
        note: "Invalid same-status transition QA",
        visibility: "INTERNAL",
        actorUserId: IDS.admin,
      } }),
      (error: unknown) => {
        const failure = databaseFailure(error);
        return failure.prismaCode === "P2039"
          && failure.sqlState === "23514"
          && failure.modelName === "OrderEvent"
          && failure.constraintName === "order_events_status_changes";
      },
    );
    const acceptedAnnotation = await prisma.orderEvent.create({ data: {
      orderId: IDS.paidOrder,
      fromStatus: null,
      toStatus: "FINALIZING",
      note: "Valid current-status annotation QA",
      visibility: "INTERNAL",
      actorUserId: IDS.admin,
    } });
    assert.equal(acceptedAnnotation.fromStatus, null);
    assert.equal(acceptedAnnotation.toStatus, "FINALIZING");
    await prisma.orderEvent.delete({ where: { id: acceptedAnnotation.id } });
    assert.equal(await prisma.orderEvent.count({ where: { orderId: IDS.paidOrder } }), eventCountBeforeConstraintProof);
    passed.push("SQL CHECK rejects false transitions and accepts current-status annotations");

    const rollbackSource = source({ filename: "rollback.pdf", extension: "pdf", assetType: "DOCUMENT", mimeType: "application/pdf", sizeBytes: 512, checksumCharacter: "e" });
    let failedStorageKey: string | null = null;
    const rollbackOverrides: Partial<OrderDeliveryDependencies> = {
      ...simulatedStorageOverrides,
      write: async (input) => {
        failedStorageKey = input.storageKey;
        return simulateWrite(input);
      },
    };
    await assert.rejects(
      putOrderDelivery(actor(IDS.missingAdmin, "ADMIN"), ORDER_NUMBERS[0]!, rollbackSource, rollbackOverrides),
      (error: unknown) => {
        if (!(error instanceof OrderDeliveryProcessingError) || error.stage !== "database_persist" || error.cleanupOutcome !== "succeeded") return false;
        const failure = databaseFailure(error);
        return failure.modelName === "OrderEvent"
          && (failure.prismaCode === "P2003" || failure.sqlState === "23503")
          && (failure.constraintName === null || failure.constraintName === "order_events_actorUserId_fkey");
      },
    );
    assert.ok(failedStorageKey);
    assert.equal(await prisma.asset.count({ where: { storageKey: failedStorageKey } }), 0);
    assert.equal(await prisma.orderAsset.count({ where: { orderId: IDS.paidOrder, role: "DELIVERY" } }), 0);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: IDS.paidOrder, note: { startsWith: ADDITION_NOTE_PREFIX } } }), 0);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: IDS.paidOrder } })).status, "FINALIZING");
    assert.equal(await prisma.payment.count({ where: { id: IDS.payment, status: "SUCCEEDED" } }), 1);
    assert.equal(storedObjects.size, 0);
    assert.equal(deletedObjects.length, 1);
    passed.push("database failure after Asset and OrderAsset rolls the transaction back and compensates storage");

    const firstSource = source({ filename: "master.wav", extension: "wav", assetType: "AUDIO", mimeType: "audio/wav", sizeBytes: 62_956_924, checksumCharacter: "b" });
    const secondSource = source({ filename: "sources.zip", extension: "zip", assetType: "DOCUMENT", mimeType: "application/zip", sizeBytes: 2_048, checksumCharacter: "c" });
    const thirdSource = source({ filename: "notice.pdf", extension: "pdf", assetType: "DOCUMENT", mimeType: "application/pdf", sizeBytes: 1_024, checksumCharacter: "d" });
    const first = await putOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, firstSource, simulatedStorageOverrides);
    const firstLink = await prisma.orderAsset.findUniqueOrThrow({
      where: { orderId_assetId_role: { orderId: IDS.paidOrder, assetId: first.id, role: "DELIVERY" } },
      include: { asset: true },
    });
    assert.equal(firstLink.position, 0);
    assert.equal(firstLink.asset.sizeBytes, 62_956_924n);
    assert.equal(firstLink.asset.mimeType, "audio/wav");
    const firstEvent = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: IDS.paidOrder, note: { startsWith: ADDITION_NOTE_PREFIX } } });
    assert.equal(firstEvent.fromStatus, null);
    assert.equal(firstEvent.toStatus, "FINALIZING");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: IDS.paidOrder } })).status, "FINALIZING");
    assert.equal(await prisma.payment.count({ where: { id: IDS.payment, status: "SUCCEEDED" } }), 1);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: IDS.paidOrder, kind: "CUSTOMER_DELIVERY_READY" } }), 0);
    passed.push("first real persistence commits Asset, Delivery position zero and audit annotation");

    const second = await putOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, secondSource, simulatedStorageOverrides);
    const third = await putOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, thirdSource, simulatedStorageOverrides);
    const deliveryLinks = await prisma.orderAsset.findMany({
      where: { orderId: IDS.paidOrder, role: "DELIVERY" },
      orderBy: { position: "asc" },
      include: { asset: true },
    });
    assert.deepEqual(deliveryLinks.map(({ position }) => position), [0, 1, 2]);
    assert.deepEqual(deliveryLinks.map(({ assetId }) => assetId), [first.id, second.id, third.id]);
    const additionEvents = await prisma.orderEvent.findMany({
      where: { orderId: IDS.paidOrder, note: { startsWith: ADDITION_NOTE_PREFIX } },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(additionEvents.length, 3);
    assert.ok(additionEvents.every(({ fromStatus, toStatus, visibility }) => fromStatus === null && toStatus === "FINALIZING" && visibility === "INTERNAL"));
    assert.equal(storedObjects.size, 3);
    passed.push("second and third real persistence allocate positions one and two");

    assert.equal(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, first.id), null);
    assert.ok(await getOrderDeliveryForActor(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, first.id));
    assert.equal(await getOrderDeliveryForActor(actor(IDS.other, "MEMBER"), ORDER_NUMBERS[0]!, first.id), null);
    assert.equal(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[1]!, first.id), null);

    await removeOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, first.id, simulatedRemovalOverrides);
    assert.equal(await prisma.asset.count({ where: { id: first.id } }), 0);
    assert.equal(await prisma.orderAsset.count({ where: { orderId: IDS.paidOrder, assetId: first.id, role: "DELIVERY" } }), 0);
    const removalEvent = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: IDS.paidOrder, note: REMOVAL_NOTE } });
    assert.equal(removalEvent.fromStatus, null);
    assert.equal(removalEvent.toStatus, "FINALIZING");
    assert.equal(removalEvent.visibility, "INTERNAL");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: IDS.paidOrder } })).status, "FINALIZING");
    assert.equal(await prisma.orderNotification.count({ where: { orderId: IDS.paidOrder, kind: "CUSTOMER_DELIVERY_READY" } }), 0);
    assert.equal(storedObjects.size, 2);
    assert.ok(deletedObjects.some((key) => key === firstLink.asset.storageKey));
    passed.push("real pre-publication removal preserves status and writes an audit annotation");

    const doubleDelivery = await Promise.all([
      transitionOrderStatus(ORDER_NUMBERS[0]!, "DELIVERED", IDS.admin),
      transitionOrderStatus(ORDER_NUMBERS[0]!, "DELIVERED", IDS.admin),
    ]);
    assert.deepEqual(doubleDelivery, ["DELIVERED", "DELIVERED"]);
    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: IDS.paidOrder } });
    assert.equal(delivered.status, "DELIVERED");
    assert.ok(delivered.deliveredAt && delivered.downloadExpiresAt);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: IDS.paidOrder, fromStatus: "FINALIZING", toStatus: "DELIVERED" } }), 1);
    const notifications = await prisma.orderNotification.findMany({ where: { orderId: IDS.paidOrder, kind: "CUSTOMER_DELIVERY_READY" } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.status, "PENDING");
    assert.equal(notifications[0]?.attempts, 0);
    assert.equal(notifications[0]?.providerMessageId, null);
    assert.ok(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, second.id));
    assert.ok(await getOrderDeliveryForActor(actor(IDS.member, "MEMBER"), ORDER_NUMBERS[0]!, third.id));
    await assert.rejects(removeOrderDelivery(actor(IDS.admin, "ADMIN"), ORDER_NUMBERS[0]!, second.id, simulatedRemovalOverrides), (error: unknown) => error instanceof OrderDeliveryError && error.code === "ORDER_NOT_DELIVERABLE");
    assert.equal(await prisma.orderAsset.count({ where: { orderId: IDS.paidOrder, role: "DELIVERY" } }), 2);
    assert.equal(storedObjects.size, 2);
    passed.push("concurrent publish remains idempotent with one transition and one notification");

    console.info(`V0.7.5 delivery runtime passed (${passed.length} groups).`);
  } finally {
    await cleanup();
    storedObjects.clear();
    await assertFreshDatabase();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Delivery runtime validation failed.");
    process.exitCode = 1;
  });

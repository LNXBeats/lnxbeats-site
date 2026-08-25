import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { clearQaOrderStorage, readPrivateOrderFile } from "@/lib/orders/storage";
import {
  addOrderPhotos,
  createDraftOrder,
  deleteDraftOrder,
  deleteOrderPhoto,
  enforceOrderRateLimit,
  finalizeOrder,
  getOrderForActor,
  getDraftForActor,
  getOrderPhotoForActor,
  listMemberOrders,
  saveDraftOrder,
} from "@/lib/orders/service";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v060-test";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v060-test/server.json";
const QA_EMAILS = {
  member: "lnx-v060-member@example.invalid",
  other: "lnx-v060-other@example.invalid",
  admin: "lnx-v060-admin@example.invalid",
} as const;

const baseInput: OrderDraftInput = {
  title: "Runtime V0.6",
  recipient: "Une personne fictive",
  occasion: "Validation locale",
  brief: "Cette histoire fictive est assez longue pour valider le parcours de commande sans donnée réelle.",
  musicalDirection: "Cinématographique",
  emotion: "Sincère",
  importantDetails: "Aucune donnée personnelle réelle.",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  coverIncluded: false,
  priorityProcessing: false,
};

async function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE);
  assert.equal(process.env.ORDER_UPLOAD_MODE, "local-qa");
  assert.equal(process.env.ORDER_UPLOAD_DIR, "/private/tmp/lnx-studio-v060-uploads");
  assert.ok(process.env.DATABASE_URL);
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);

  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.ok(url.port && url.port !== "5432");

  const proof = JSON.parse(await readFile(EXPECTED_SERVER_FILE, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, EXPECTED_TARGET);
  assert.ok(proof.pid && proof.pid > 0);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.orderNotification.deleteMany();
    await transaction.orderAsset.deleteMany();
    await transaction.commercialLicense.deleteMany();
    await transaction.orderEvent.deleteMany();
    await transaction.order.deleteMany();
    await transaction.asset.deleteMany();
    await transaction.customer.deleteMany();
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
  await clearQaOrderStorage();
}

async function assertClean(stage: string) {
  const counts = await Promise.all([
    prisma.order.count(), prisma.orderEvent.count(), prisma.orderAsset.count(), prisma.commercialLicense.count(), prisma.asset.count(),
    prisma.customer.count(), prisma.rateLimit.count(), prisma.account.count(), prisma.session.count(),
    prisma.user.count({ where: { email: { endsWith: "@example.invalid" } } }),
  ]);
  assert.ok(counts.every((count) => count === 0), `${stage}: disposable order data remains.`);
}

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

async function run() {
  await validateSafetyGuards();
  await cleanup();
  await assertClean("precondition");
  const passed: string[] = [];
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;

  try {
    const [memberUser, otherUser, adminUser] = await Promise.all([
      createInternalAuthUser({ email: QA_EMAILS.member, password, displayName: "LNX Order Member QA", role: "MEMBER" }),
      createInternalAuthUser({ email: QA_EMAILS.other, password, displayName: "LNX Order Other QA", role: "MEMBER" }),
      createInternalAuthUser({ email: QA_EMAILS.admin, password, displayName: "LNX Order Admin QA", role: "ADMIN" }),
    ]);
    const member = actor(memberUser);
    const other = actor(otherUser);
    const admin = actor(adminUser);

    await assert.rejects(createDraftOrder({ ...member, id: "00000000-0000-4000-8000-000000000001" }, baseInput));
    assert.equal(await prisma.order.count(), 0);
    passed.push("unknown owner rejected without partial order");

    const historicalOrderNumber = "LNX-2099-083001";
    await prisma.order.create({
      data: {
        orderNumber: historicalOrderNumber,
        userId: member.id,
        customerEmail: member.email,
        customerName: member.name,
        status: "DRAFT",
        title: "Runtime historique V0.8.3",
        brief: "Cette commande historique fictive prouve que le snapshot tarifaire V1 reste immuable après le passage à V2.",
        usage: "PERSONAL",
        coverIncluded: false,
        priorityProcessing: false,
        basePriceCents: 5_000,
        coverPriceCents: 0,
        priorityPriceCents: 0,
        totalCents: 5_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
        contractRequired: false,
      },
    });
    const savedHistorical = await saveDraftOrder(member, historicalOrderNumber, {
      ...baseInput,
      coverIncluded: true,
      priorityProcessing: true,
    });
    assert.equal(savedHistorical.status, "DRAFT");
    assert.equal(savedHistorical.pricingVersion, "2026-08-v1");
    assert.equal(savedHistorical.basePriceCents, 5_000);
    assert.equal(savedHistorical.coverPriceCents, 1_000);
    assert.equal(savedHistorical.priorityPriceCents, 3_000);
    assert.equal(savedHistorical.totalCents, 9_000);
    const finalizedHistorical = await finalizeOrder(member, historicalOrderNumber, {
      ...baseInput,
      coverIncluded: true,
      priorityProcessing: false,
    }, true);
    assert.equal(finalizedHistorical.status, "AWAITING_PAYMENT");
    assert.equal(finalizedHistorical.pricingVersion, "2026-08-v1");
    assert.equal(finalizedHistorical.basePriceCents, 5_000);
    assert.equal(finalizedHistorical.coverPriceCents, 1_000);
    assert.equal(finalizedHistorical.priorityPriceCents, 0);
    assert.equal(finalizedHistorical.totalCents, 6_000);
    const persistedHistorical = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: historicalOrderNumber },
    });
    assert.equal(persistedHistorical.pricingVersion, "2026-08-v1");
    assert.equal(persistedHistorical.basePriceCents, 5_000);
    assert.equal(persistedHistorical.totalCents, 6_000);
    passed.push("historical V1 draft keeps its 50/60/90 EUR grid through save and finalization");

    const draft = await createDraftOrder(member, { ...baseInput, brief: "" });
    assert.match(draft.orderNumber, /^LNX-\d{4}-\d{6}$/);
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.pricingVersion, "2026-08-v2");
    assert.equal(draft.basePriceCents, 2_000);
    assert.equal(draft.totalCents, 2_000);
    assert.equal(draft.events.length, 1);
    passed.push("private draft and client event created");

    const priced = await saveDraftOrder(member, draft.orderNumber, {
      ...baseInput,
      coverIncluded: true,
      priorityProcessing: true,
    });
    assert.equal(priced.usage, "PERSONAL");
    assert.equal(priced.pricingVersion, "2026-08-v2");
    assert.equal(priced.basePriceCents, 2_000);
    assert.equal(priced.totalCents, 6_000);
    assert.equal(priced.contractRequired, false);
    assert.equal((await getDraftForActor(member, draft.orderNumber))?.orderNumber, draft.orderNumber);
    await assert.rejects(saveDraftOrder(other, draft.orderNumber, baseInput));
    passed.push("server pricing snapshot persisted");

    const photoBuffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#263238" } }).jpeg().toBuffer();
    await assert.rejects(addOrderPhotos(member, draft.orderNumber, Array.from({ length: 11 }, () => ({ buffer: photoBuffer, originalFilename: "too-many.jpg", declaredMimeType: "image/jpeg" }))));
    const withPhoto = await addOrderPhotos(member, draft.orderNumber, [{ buffer: photoBuffer, originalFilename: "../../reference.jpg", declaredMimeType: "image/jpeg" }]);
    assert.equal(withPhoto.photos.length, 1);
    assert.equal(withPhoto.photos[0]?.mimeType, "image/webp");
    const photoId = withPhoto.photos[0]?.id;
    assert.ok(photoId);
    assert.equal(await getOrderPhotoForActor(other, draft.orderNumber, photoId), null);
    await assert.rejects(deleteOrderPhoto(other, draft.orderNumber, photoId));
    assert.ok(await getOrderPhotoForActor(member, draft.orderNumber, photoId));
    assert.ok(await getOrderPhotoForActor(admin, draft.orderNumber, photoId));
    passed.push("photo normalized and protected against IDOR");

    const invalid = await createDraftOrder(other, { ...baseInput, brief: "" });
    await assert.rejects(finalizeOrder(other, invalid.orderNumber, { ...baseInput, brief: "court" }, true));
    const invalidPersisted = await prisma.order.findUniqueOrThrow({ where: { orderNumber: invalid.orderNumber } });
    assert.equal(invalidPersisted.status, "DRAFT");
    assert.equal(await prisma.orderEvent.count({ where: { orderId: invalidPersisted.id } }), 1);
    passed.push("invalid finalization rolled back");

    const finalized = await finalizeOrder(member, draft.orderNumber, {
      ...baseInput,
      coverIncluded: true,
      priorityProcessing: true,
    }, true);
    assert.equal(finalized.status, "AWAITING_PAYMENT");
    assert.equal(finalized.events.length, 2);
    assert.ok(finalized.submittedAt);
    assert.equal(finalized.usage, "PERSONAL");
    assert.equal(finalized.pricingVersion, "2026-08-v2");
    assert.equal(finalized.basePriceCents, 2_000);
    assert.equal(finalized.totalCents, 6_000);
    const editableBeforeCheckout = await saveDraftOrder(member, draft.orderNumber, baseInput);
    assert.equal(editableBeforeCheckout.status, "AWAITING_PAYMENT");
    assert.equal(editableBeforeCheckout.pricingVersion, "2026-08-v2");
    assert.equal(editableBeforeCheckout.totalCents, 2_000);
    const restoredBeforeCheckout = await saveDraftOrder(member, draft.orderNumber, {
      ...baseInput,
      coverIncluded: true,
      priorityProcessing: true,
    });
    assert.equal(restoredBeforeCheckout.pricingVersion, "2026-08-v2");
    assert.equal(restoredBeforeCheckout.totalCents, 6_000);
    assert.equal(await getOrderForActor(other, draft.orderNumber), null);
    assert.ok(await getOrderForActor(admin, draft.orderNumber));
    assert.deepEqual((await listMemberOrders(other)).map((order) => order.orderNumber), [invalid.orderNumber]);
    passed.push("atomic finalization, pre-Checkout editing and access control validated");

    const deliveredAt = new Date();
    await prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUniqueOrThrow({ where: { orderNumber: draft.orderNumber } });
      await transaction.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt } });
      await transaction.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: "AWAITING_PAYMENT",
          toStatus: "DELIVERED",
          note: "Livraison fictive créée par la validation locale jetable.",
          visibility: "CLIENT",
          actorUserId: admin.id,
        },
      });
    });
    const delivered = await getOrderForActor(member, draft.orderNumber);
    assert.equal(delivered?.status, "DELIVERED");
    assert.equal(delivered?.pricingVersion, "2026-08-v2");
    assert.equal(delivered?.totalCents, 6_000);
    assert.equal(delivered?.usage, "PERSONAL");
    passed.push("delivered order remains personal and eligible for the separate V0.7.2 rights workflow");

    const stored = await prisma.order.findUniqueOrThrow({ where: { orderNumber: draft.orderNumber } });
    await prisma.orderEvent.create({ data: { orderId: stored.id, toStatus: stored.status, note: "Note interne QA", visibility: "INTERNAL", actorUserId: admin.id } });
    const memberView = await getOrderForActor(member, draft.orderNumber);
    assert.equal(memberView?.events.some((event) => event.note === "Note interne QA"), false);
    await assert.rejects(prisma.order.update({ where: { id: stored.id }, data: { revisionUsed: 2 } }));
    await assert.rejects(prisma.order.update({ where: { id: stored.id }, data: { totalCents: 1 } }));
    passed.push("internal notes hidden and SQL checks enforced");

    const concurrentUsers = [];
    for (let index = 0; index < 6; index += 1) {
      concurrentUsers.push(await prisma.user.create({
        data: {
          email: `lnx-v060-concurrent-${index}@example.invalid`, displayName: `Concurrent ${index}`,
          emailVerified: true, emailVerifiedAt: new Date(), status: "ACTIVE", role: "MEMBER",
        },
      }));
    }
    const concurrentOrders = await Promise.all(concurrentUsers.map((user) => createDraftOrder(actor(user), baseInput)));
    assert.equal(new Set(concurrentOrders.map((order) => order.orderNumber)).size, concurrentOrders.length);
    passed.push("concurrent order numbers unique");

    const deletable = await createDraftOrder(other, baseInput);
    const deletableWithPhoto = await addOrderPhotos(other, deletable.orderNumber, [{ buffer: photoBuffer, originalFilename: "delete.jpg", declaredMimeType: "image/jpeg" }]);
    const deleteAsset = await prisma.asset.findUniqueOrThrow({ where: { id: deletableWithPhoto.photos[0]?.id } });
    await deleteDraftOrder(other, deletable.orderNumber);
    assert.equal(await prisma.order.count({ where: { orderNumber: deletable.orderNumber } }), 0);
    await assert.rejects(readPrivateOrderFile(deleteAsset.storageKey));
    passed.push("draft and private file deletion validated");

    await Promise.all(Array.from({ length: 30 }, () => enforceOrderRateLimit(admin.id, "delete")));
    await assert.rejects(enforceOrderRateLimit(admin.id, "delete"), (error: unknown) => (
      error instanceof Error && "code" in error && error.code === "RATE_LIMITED"
    ));
    passed.push("shared order rate limit enforced under concurrency");

    console.info(`V0.6 order runtime passed (${passed.length} groups):`);
    passed.forEach((label) => console.info(`- ${label}`));
  } finally {
    await cleanup();
    await assertClean("postcondition");
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Order runtime validation failed.");
    process.exitCode = 1;
  });

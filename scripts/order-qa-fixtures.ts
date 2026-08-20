import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { clearQaOrderStorage } from "@/lib/orders/storage";
import { createDraftOrder, finalizeOrder } from "@/lib/orders/service";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v060-test";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v060-test/server.json";
const QA_EMAILS = ["lnx-v060-browser-member@example.invalid", "lnx-v060-browser-admin@example.invalid"] as const;

async function guards() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE);
  assert.equal(process.env.ORDER_UPLOAD_MODE, "local-qa");
  assert.equal(process.env.ORDER_UPLOAD_DIR, "/private/tmp/lnx-studio-v060-uploads");
  assert.ok(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.ok(url.port && url.port !== "5432");
  const proof = JSON.parse(await readFile(EXPECTED_SERVER_FILE, "utf8")) as { name?: string; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, EXPECTED_TARGET);
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
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
  await clearQaOrderStorage();
}

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

const input: OrderDraftInput = {
  title: "Histoire QA", recipient: "Une personne fictive", occasion: "Contrôle navigateur",
  brief: "Une histoire fictive suffisamment détaillée pour le contrôle navigateur de la commande.",
  musicalDirection: "Cinématographique", emotion: "Lumineuse", importantDetails: "",
  wordsToInclude: "", avoid: "", pronunciationNotes: "",
  coverIncluded: true, priorityProcessing: false,
};

async function run() {
  await guards();
  const operation = process.argv[2];
  if (operation === "cleanup") {
    await cleanup();
    console.info("Order browser QA fixtures removed.");
    return;
  }
  assert.equal(operation, "setup", "Use setup or cleanup.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  await cleanup();
  const memberUser = await createInternalAuthUser({ email: QA_EMAILS[0], password: process.env.LNX_AUTH_QA_PASSWORD, displayName: "LNX Browser Member QA", role: "MEMBER" });
  await createInternalAuthUser({ email: QA_EMAILS[1], password: process.env.LNX_AUTH_QA_PASSWORD, displayName: "LNX Browser Admin QA", role: "ADMIN" });
  const member = actor(memberUser);
  const draft = await createDraftOrder(member, { ...input, title: "Brouillon à reprendre" });
  const submitted = await createDraftOrder(member, { ...input, title: "Commande non livrée" });
  await finalizeOrder(member, submitted.orderNumber, input, true);
  const delivered = await createDraftOrder(member, { ...input, title: "Création livrée" });
  await finalizeOrder(member, delivered.orderNumber, input, true);
  const requested = await createDraftOrder(member, { ...input, title: "Droits demandés" });
  await finalizeOrder(member, requested.orderNumber, input, true);

  async function markDelivered(orderNumber: string) {
    await prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUniqueOrThrow({ where: { orderNumber } });
      await transaction.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      await transaction.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: "AWAITING_PAYMENT",
          toStatus: "DELIVERED",
          note: "Livraison fictive réservée au contrôle navigateur local.",
          visibility: "CLIENT",
        },
      });
    });
  }

  await markDelivered(delivered.orderNumber);
  await markDelivered(requested.orderNumber);
  console.info(`Order browser fixtures created: draft ${draft.orderNumber}, undelivered ${submitted.orderNumber}, delivered ${delivered.orderNumber}, rights-eligible ${requested.orderNumber}.`);
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Order fixture operation failed.");
  process.exitCode = 1;
});

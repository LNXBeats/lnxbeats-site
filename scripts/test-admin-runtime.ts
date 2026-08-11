import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  addInternalOrderNote,
  getAdminOrder,
  getDatabaseCatalogueAudit,
  listAdminMembers,
  listAdminOrders,
  transitionOrderStatus,
} from "@/lib/admin/service";
import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { canAccessAdmin } from "@/lib/auth/roles";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { createDraftOrder, finalizeOrder, getOrderForActor } from "@/lib/orders/service";
import { clearQaOrderStorage } from "@/lib/orders/storage";
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
    await finalizeOrder(member, draft.orderNumber, input);
    const listed = await listAdminOrders("all");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.orderNumber, draft.orderNumber);
    assert.equal((await getAdminOrder(draft.orderNumber))?.customerEmail, MEMBER_EMAIL);
    passed.push("real order list and detail");

    await assert.rejects(transitionOrderStatus(draft.orderNumber, "DELIVERED", adminUser.id));
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
    passed.push("valid transition atomic, invalid and concurrent duplicate transitions refused");

    await addInternalOrderNote(draft.orderNumber, "Note réservée au cockpit.", adminUser.id);
    const adminDetail = await getAdminOrder(draft.orderNumber);
    assert.equal(adminDetail?.events.some(({ visibility }) => visibility === "INTERNAL"), true);
    const clientDetail = await getOrderForActor(member, draft.orderNumber);
    assert.equal(clientDetail?.events.some(({ note }) => note === "Note réservée au cockpit."), false);
    passed.push("internal event hidden from member serialization");

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

/** Existing isolated synthetic QA. No Production access, provider call or cleanup. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";

const cfg = JSON.parse(await fs.readFile(".private/express-qa.json", "utf8"));
const url = new URL(cfg.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55522");
assert.equal(url.pathname, "/lnx_dcn_v12_express_test_20261017");
// The Express runtime deliberately cannot insert ordinary orders. Fixtures
// use this existing cluster's local bootstrap role, not widened runtime grants.
const socket = "/private/tmp/lnx-dcn-v12-express-socket";
const check = new Client({ host: socket, port: 55522, user: "express_bootstrap", database: url.pathname.slice(1) });
await check.connect();
try {
  const identity = (await check.query("SELECT current_database() AS db, current_user AS role, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listen")).rows[0];
  assert.equal(identity.db, "lnx_dcn_v12_express_test_20261017"); assert.equal(identity.role, "express_bootstrap"); assert.equal(identity.listen, "127.0.0.1");
  assert.equal(identity.directory, "/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_V12_ADMIN_EXPRESS_20261017/postgres/data");
} finally { await check.end(); }
url.username = "express_bootstrap"; url.password = ""; url.searchParams.set("host", socket);
for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|AWS|R2|S3|RAILWAY|DATABASE_URL|AUTH_SECRET/.test(key)) delete process.env[key];
Object.assign(process.env, cfg, { DATABASE_URL: url.toString(), NOTIFICATION_WORKER_ENABLED: "false", PAYMENTS_ENABLED: "false", EMAIL_PROVIDER: "disabled" });
globalThis.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const { prisma } = await import("@/lib/prisma");
const { getCreationWorkQueue, updateCreationWork } = await import("@/lib/admin/creation-work");
const { transitionOrderStatus } = await import("@/lib/admin/service");
const out = "/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/ADMIN_CENTRE_ACTION_20261018";
const results: Record<string, string> = {};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex");
const protectedState = async () => hash([
  await prisma.project.findMany({ orderBy: { id: "asc" } }), await prisma.track.findMany({ orderBy: { id: "asc" } }),
  await prisma.digitalMaster.findMany({ orderBy: { id: "asc" } }), await prisma.digitalOffer.findMany({ orderBy: { id: "asc" } }),
  await prisma.digitalEntitlement.findMany({ orderBy: { id: "asc" } }), await prisma.asset.findMany({ orderBy: { id: "asc" } }),
  await prisma.providerEvent.findMany({ orderBy: { id: "asc" } }),
]);
try {
  const before = await protectedState();
  const run = randomUUID();
  const admin = await prisma.user.create({ data: { email: `creation-work-${run}@example.invalid`, displayName: "QA Centre d’action", role: "ADMIN", status: "ACTIVE", emailVerified: true } });
  const member = await prisma.user.create({ data: { email: `creation-work-member-${run}@example.invalid`, role: "MEMBER", status: "ACTIVE", emailVerified: true } });
  const old = new Date(Date.now() - 10 * 86_400_000);
  const count = await prisma.order.count({ where: { orderNumber: { startsWith: "LNX-2199-9" } } });
  const number = (i: number) => `LNX-2199-${String(900000 + count + i).padStart(6, "0")}`;
  const create = (i: number, status: "IN_PROGRESS" | "REVIEWING" | "FINALIZING" | "REFUSED", title: string) => prisma.order.create({ data: {
    orderNumber: number(i), customerEmail: "creation-work-synthetic@example.invalid", customerName: "Démonstration synthétique QA",
    status, title, brief: "Fixture synthétique : aucun client ni paiement réel.", createdAt: old, submittedAt: old,
    events: { create: { toStatus: status === "REFUSED" ? "REFUSED" : "ACCEPTED", note: "Fixture synthétique : début historique du suivi.", visibility: "INTERNAL", createdAt: old } },
    payments: { create: { provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5000, currency: "EUR", pricingVersion: "synthetic-no-provider", idempotencyKey: `synthetic-centre:${run}:${i}`, paidAt: old } },
  } });
  const work = await create(1, "IN_PROGRESS", "QA — Une chanson pour notre anniversaire");
  const refused = await create(2, "REFUSED", "QA — Essai personnel refusé");
  const input = { orderNumber: work.orderNumber, actorUserId: admin.id, requestId: randomUUID(), expectedUpdatedAt: work.updatedAt.toISOString(), expectedRevision: "", kind: "DEADLINE" as const, deadline: "2026-10-28T17:00" };
  await updateCreationWork(input);
  const eventCount = await prisma.orderEvent.count({ where: { orderId: work.id } });
  const ids = await Promise.all([updateCreationWork(input), updateCreationWork(input)]); assert.equal(ids[0], ids[1]);
  assert.equal(await prisma.orderEvent.count({ where: { orderId: work.id } }), eventCount); results.DOUBLE_SUBMIT_ONE_INTERNAL_EVENT = "PASS";
  let queue = await getCreationWorkQueue();
  let item = queue.items.find(({ id }) => id === work.id)!;
  assert(item); assert.equal(item.startedAt, old.toISOString()); assert.equal(item.dueAt, "2026-10-28T16:00:00.000Z");
  assert(!queue.items.some(({ id }) => id === refused.id)); results.WORK_QUEUE_AND_PERSISTENT_PARIS_DEADLINE = "PASS";
  await assert.rejects(updateCreationWork({ ...input, requestId: randomUUID() })); results.STALE_EDIT_REJECTED = "PASS";
  await assert.rejects(updateCreationWork({ ...input, requestId: randomUUID(), expectedRevision: item.deadlineRevision, actorUserId: member.id })); results.MEMBER_WRITE_REFUSED = "PASS";
  await assert.rejects(updateCreationWork({ ...input, requestId: randomUUID(), expectedRevision: item.deadlineRevision, deadline: "2026-10-25T02:30" })); results.AMBIGUOUS_PARIS_HOUR_REJECTED = "PASS";
  const orderBefore = hash(await prisma.order.findUniqueOrThrow({ where: { id: work.id }, include: { payments: true } }));
  const hide = { ...input, kind: "HIDE" as const, requestId: randomUUID(), expectedRevision: "" };
  await assert.rejects(updateCreationWork(hide)); results.HIDE_REQUIRES_OWNER_CONFIRMATION = "PASS";
  await updateCreationWork({ ...hide, confirmedTest: true });
  queue = await getCreationWorkQueue(); assert(!queue.items.some(({ id }) => id === work.id));
  item = queue.hidden.find(({ id }) => id === work.id)!; assert(item);
  assert.equal(hash(await prisma.order.findUniqueOrThrow({ where: { id: work.id }, include: { payments: true } })), orderBefore);
  results.HIDE_ONLY_PRESENTATION_ORDER_PAYMENT_STATUS_UNCHANGED = "PASS";
  await updateCreationWork({ ...hide, kind: "RESTORE", requestId: randomUUID(), expectedRevision: item.visibilityRevision });
  queue = await getCreationWorkQueue(); item = queue.items.find(({ id }) => id === work.id)!; assert(item); results.RESTORE_VISIBLE = "PASS";
  const hideAgain = { ...hide, requestId: randomUUID(), expectedRevision: item.visibilityRevision, confirmedTest: true };
  await updateCreationWork(hideAgain);
  await transitionOrderStatus(work.orderNumber, "FIRST_VERSION_READY", admin.id);
  queue = await getCreationWorkQueue(); item = queue.items.find(({ id }) => id === work.id)!;
  assert(item); assert.equal(item.status, "FIRST_VERSION_READY"); assert.equal(item.startedAt, old.toISOString()); assert.equal(item.dueAt, "2026-10-28T16:00:00.000Z");
  results.BUSINESS_UPDATE_RESURFACES_HIDDEN_TEST_WITHOUT_RESETTING_DEADLINE = "PASS";
  await assert.rejects(transitionOrderStatus(work.orderNumber, "DELIVERED", admin.id)); results.NO_SKIP_TO_DELIVERY = "PASS";
  const review = await create(3, "REVIEWING", "QA — Un hommage à préparer");
  await transitionOrderStatus(review.orderNumber, "ACCEPTED", admin.id);
  await assert.rejects(transitionOrderStatus(review.orderNumber, "ACCEPTED", admin.id));
  assert.equal(await prisma.orderEvent.count({ where: { orderId: review.id, fromStatus: "REVIEWING", toStatus: "ACCEPTED" } }), 1); results.EXISTING_ENGINE_ONE_STATUS_TRANSITION = "PASS";
  assert.equal(await protectedState(), before); results.CATALOGUE_MASTERS_OFFERS_ACQUISITIONS_RECEIPTS_UNCHANGED = "PASS";
  // Leave representative synthetic fixtures for the local visual demonstration.
  const urgent = await create(4, "FINALIZING", "QA — Anniversaire : livraison imminente");
  const overdue = await create(5, "IN_PROGRESS", "QA — Création à relancer en priorité");
  const { parisDateTime } = await import("@/lib/admin/creation-work-policy");
  for (const [order, days] of [[urgent, .5], [overdue, -1]] as const) await updateCreationWork({ orderNumber: order.orderNumber, actorUserId: admin.id, requestId: randomUUID(), expectedUpdatedAt: order.updatedAt.toISOString(), expectedRevision: "", kind: "DEADLINE", deadline: parisDateTime(new Date(Date.now() + days * 86_400_000)) });
  await fs.mkdir(out + "/proofs", { recursive: true, mode: 0o700 });
  await fs.writeFile(out + "/proofs/RUNTIME.json", JSON.stringify({ at: new Date().toISOString(), results, orderNumbers: [work, review, urgent, overdue].map(o => o.orderNumber), protectedHash: before, providerCalls: 0, productionWrites: 0, recoveryWrites: 0, deletedRows: 0 }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(results));
} finally { await prisma.$disconnect(); }

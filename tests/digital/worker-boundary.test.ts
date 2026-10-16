import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "@/lib/prisma";
import { processDigitalArchives, ensureDigitalArchive } from "@/lib/digital/archive-worker";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { digitalReconciliationDependencies } from "../../scripts/digital-reconcile";

// Prisma method doubles only. These tests never open a connection, touch an
// audio file, create a download, invoke a PSP or alter a QA/Production row.
const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
  MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_WORKER_ENABLED: "true",
  DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "false" };
const id = "0da7e907-67d8-44ba-bd89-445a86f07a77";
function liveEnvironment() {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^DCN_(R4_|LOCAL_QA_)/.test(key)) delete process.env[key];
  for (const key of ["DCN_EXTERNAL_TEST_AUTHORIZED", "DCN_LOCAL_REVIEW_AUTHORIZED", "DCN_RECOVERY_EXCERPTS_REVIEW_ONLY", "RAILWAY_ENVIRONMENT"]) delete process.env[key];
  Object.assign(process.env, live);
  return () => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); };
}

test("isolated media workers respect a pre-aborted shutdown without querying or touching files", async () => {
  const restore = liveEnvironment(), shutdown = new AbortController(); shutdown.abort();
  const uploadFind = prisma.digitalUpload.findFirst, archiveFind = prisma.digitalArchive.findFirst;
  let queries = 0;
  prisma.digitalUpload.findFirst = (async () => { queries++; throw new Error("No DB query allowed"); }) as unknown as typeof uploadFind;
  prisma.digitalArchive.findFirst = (async () => { queries++; throw new Error("No DB query allowed"); }) as unknown as typeof archiveFind;
  try {
    assert.deepEqual(await processDigitalMedia({ signal: shutdown.signal }), { processed: false });
    assert.deepEqual(await processDigitalArchives({ signal: shutdown.signal }), { processed: false });
    assert.equal(queries, 0);
  } finally { prisma.digitalUpload.findFirst = uploadFind; prisma.digitalArchive.findFirst = archiveFind; restore(); }
});

test("archive polling and archive creation cannot cross immutable order mode", async () => {
  const restore = liveEnvironment(), archiveFind = prisma.digitalArchive.findFirst, lineFind = prisma.digitalOrderLine.findUniqueOrThrow;
  let where: unknown;
  prisma.digitalArchive.findFirst = (async (input: { where: unknown }) => { where = input.where; return null; }) as unknown as typeof archiveFind;
  prisma.digitalOrderLine.findUniqueOrThrow = (async () => ({ scope: "ALBUM", order: { mode: "TEST", status: "PAID" } })) as unknown as typeof lineFind;
  try {
    assert.deepEqual(await processDigitalArchives({ lineIds: [id] }), { processed: false });
    assert.deepEqual((where as { line: unknown }).line, { order: { mode: "LIVE" } });
    assert.deepEqual((where as { lineId: unknown }).lineId, { in: [id] });
    await assert.rejects(ensureDigitalArchive(id), { code: "ARCHIVE_UNAVAILABLE" });
  } finally { prisma.digitalArchive.findFirst = archiveFind; prisma.digitalOrderLine.findUniqueOrThrow = lineFind; restore(); }
});

test("READ recovery selects only matching orders and non-REQUESTED refunds", async () => {
  const orderFind = prisma.digitalOrder.findMany, refundFind = prisma.digitalRefund.findMany;
  const reads: Array<Record<string, unknown>> = [];
  prisma.digitalOrder.findMany = (async (input: Record<string, unknown>) => { reads.push(input); return []; }) as unknown as typeof orderFind;
  prisma.digitalRefund.findMany = (async (input: Record<string, unknown>) => { reads.push(input); return []; }) as unknown as typeof refundFind;
  try {
    await digitalReconciliationDependencies.pendingOrders("LIVE", 5, id);
    await digitalReconciliationDependencies.pendingRefunds("LIVE", 3, id);
    assert.deepEqual(reads[0].where, { mode: "LIVE", status: { in: ["PENDING", "REQUIRES_REVIEW"] }, id: { gt: id } });
    assert.deepEqual(reads[1].where, { order: { mode: "LIVE" }, status: { in: ["PENDING", "REQUIRES_REVIEW"] }, id: { gt: id } });
    assert.equal(reads[0].take, 5); assert.equal(reads[1].take, 3);
  } finally { prisma.digitalOrder.findMany = orderFind; prisma.digitalRefund.findMany = refundFind; }
});

test("a stale refund recovery id is rechecked before any provider factory or mutation", async () => {
  const restore = liveEnvironment(), find = prisma.digitalRefund.findFirst;
  let where: unknown;
  prisma.digitalRefund.findFirst = (async (input: { where: unknown }) => { where = input.where; return null; }) as unknown as typeof find;
  try {
    await digitalReconciliationDependencies.recoverRefund(id);
    assert.deepEqual(where, { id, order: { mode: "LIVE" }, status: { in: ["PENDING", "REQUIRES_REVIEW"] } });
  } finally { prisma.digitalRefund.findFirst = find; restore(); }
});

test("shutdown after claiming an archive releases its exact lease and preserves a retryable job", async () => {
  const restore = liveEnvironment(), shutdown = new AbortController();
  const archiveFind = prisma.digitalArchive.findFirst, archiveUpdate = prisma.digitalArchive.updateMany;
  const slotUpdate = prisma.digitalWorkSlot.updateMany, lineFind = prisma.digitalOrderLine.findUniqueOrThrow;
  const changes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [], slots: Array<Record<string, unknown>> = [];
  prisma.digitalArchive.findFirst = (async () => ({ id, lineId: id, attempts: 0 })) as unknown as typeof archiveFind;
  prisma.digitalArchive.updateMany = (async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => { changes.push(input); return { count: 1 }; }) as unknown as typeof archiveUpdate;
  prisma.digitalWorkSlot.updateMany = (async (input: Record<string, unknown>) => { slots.push(input); return { count: 1 }; }) as unknown as typeof slotUpdate;
  prisma.digitalOrderLine.findUniqueOrThrow = (async () => { shutdown.abort(); throw new Error("Synthetic shutdown before file or network access"); }) as unknown as typeof lineFind;
  try {
    assert.deepEqual(await processDigitalArchives({ signal: shutdown.signal }), { processed: true, ready: false });
    assert.equal(changes[0].data.status, "PROCESSING");
    assert.equal(changes[1].data.status, "PENDING"); assert.equal(changes[1].data.errorCode, "WORKER_SHUTDOWN");
    assert.deepEqual(changes[1].data.attempts, { decrement: 1 });
    assert.equal(changes[1].where.leaseToken, changes[0].data.leaseToken);
    assert.equal((slots.at(-1)?.data as { leaseToken: unknown }).leaseToken, null);
    assert.equal((slots.at(-1)?.where as { leaseToken: unknown }).leaseToken, changes[0].data.leaseToken);
  } finally {
    prisma.digitalArchive.findFirst = archiveFind; prisma.digitalArchive.updateMany = archiveUpdate;
    prisma.digitalWorkSlot.updateMany = slotUpdate; prisma.digitalOrderLine.findUniqueOrThrow = lineFind; restore();
  }
});

test("shutdown after claiming audio requeues it without encoding or deleting an original", async () => {
  const restore = liveEnvironment(), shutdown = new AbortController();
  const uploadFind = prisma.digitalUpload.findFirst, uploadUpdate = prisma.digitalUpload.updateMany, slotUpdate = prisma.digitalWorkSlot.updateMany;
  let searches = 0; const changes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [], slots: Array<Record<string, unknown>> = [];
  prisma.digitalUpload.findFirst = (async () => ++searches === 1 ? null : { id, trackId: id }) as unknown as typeof uploadFind;
  prisma.digitalUpload.updateMany = (async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    changes.push(input); if (changes.length === 1) shutdown.abort(); return { count: 1 };
  }) as unknown as typeof uploadUpdate;
  prisma.digitalWorkSlot.updateMany = (async (input: Record<string, unknown>) => { slots.push(input); return { count: 1 }; }) as unknown as typeof slotUpdate;
  try {
    const result = await processDigitalMedia({ signal: shutdown.signal });
    assert.equal(result.processed, true); assert.equal(result.ready, false); assert.equal(result.errorCode, "WORKER_SHUTDOWN");
    assert.equal(changes[0].data.status, "VALIDATING"); assert.equal(changes[1].data.status, "QUARANTINE");
    assert.equal(changes[1].where.leaseToken, changes[0].data.leaseToken);
    assert.equal((slots.at(-1)?.where as { leaseToken: unknown }).leaseToken, changes[0].data.leaseToken);
    assert.equal((slots.at(-1)?.data as { leaseToken: unknown }).leaseToken, null);
    assert.equal(searches, 2);
  } finally {
    prisma.digitalUpload.findFirst = uploadFind; prisma.digitalUpload.updateMany = uploadUpdate;
    prisma.digitalWorkSlot.updateMany = slotUpdate; restore();
  }
});

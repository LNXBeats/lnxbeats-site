/** Real isolated PostgreSQL/non-owner runtime, simulated S3 provider. This is
 * not evidence of a real R2 or Safari upload; that gate is separate. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListPartsCommand } from "@aws-sdk/client-s3";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionDeliveryUploadPrivileges } from "@/lib/orders/delivery-runtime-privileges";
import { DELIVERY_MAX_BYTES, DELIVERY_PART_BYTES } from "@/lib/orders/delivery-direct-contract";
import type { OrderActor } from "@/lib/orders/domain";

const url = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
assert.equal(url.pathname, "/lnx_delivery_direct_test"); assert.equal(process.env.NODE_ENV, "test");
assert.ok(!process.env.RAILWAY_ENVIRONMENT_ID);
const owner = new Client({ connectionString: url.toString() }); await owner.connect();
const role = "qa_delivery_runtime";
if (!(await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
await owner.query(`GRANT SELECT ON users, orders, payments TO ${role}`);
await owner.query(`GRANT SELECT, INSERT ON assets, order_assets, order_events TO ${role}`);
await provisionDeliveryUploadPrivileges(owner, role); await provisionDeliveryUploadPrivileges(owner, role);
const runtime = new URL(url); runtime.username = role; runtime.password = "";
const db = new Client({ connectionString: runtime.toString() }); await db.connect();
let checks = 0;
const check = async (name: string, action: () => Promise<void>) => { await action(); checks++; console.log(`PASS ${name}`); };
await check("non-owner ACL positive/negative", async () => {
  await db.query("SELECT * FROM order_delivery_upload_sessions LIMIT 0");
  await db.query("UPDATE order_delivery_upload_sessions SET status=status WHERE false");
  for (const sql of ["DELETE FROM order_delivery_upload_sessions WHERE false", "TRUNCATE order_delivery_upload_sessions", "ALTER TABLE order_delivery_upload_sessions ADD COLUMN forbidden int", "CREATE TABLE public.forbidden_delivery(id int)"]) await assert.rejects(db.query(sql), { code: "42501" });
});
await db.end(); process.env.DATABASE_URL = runtime.toString();
Object.assign(process.env, { MEDIA_STORAGE_DRIVER: "s3", MEDIA_STORAGE_PROVIDER: "r2", MEDIA_DEPLOYMENT_ENV: "preview",
  MEDIA_S3_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, MEDIA_S3_REGION: "auto", MEDIA_S3_FORCE_PATH_STYLE: "false",
  MEDIA_S3_ACCESS_KEY_ID: "synthetic-no-remote-credential", MEDIA_S3_SECRET_ACCESS_KEY: "synthetic-no-remote-credential",
  MEDIA_PUBLIC_BUCKET: "qa-public-preview", MEDIA_PRIVATE_BUCKET: "qa-private-preview" });
const { setS3ClientFactoryForTests } = await import("@/lib/media/storage/s3");
type Remote = { key: string; contentType: string; metadata: Record<string, string>; parts: Array<{ PartNumber: number; ETag: string; Size: number }>; source?: string };
const uploads = new Map<string, Remote>(), objects = new Map<string, Remote>();
let completeCalls = 0, getCalls = 0, loseCompletionReply = false;
setS3ClientFactoryForTests(() => ({ config: {}, async send(command: unknown) {
  if (command instanceof CreateMultipartUploadCommand) {
    const id = randomUUID(); uploads.set(id, { key: command.input.Key!, contentType: command.input.ContentType!, metadata: command.input.Metadata!, parts: [] }); return { UploadId: id };
  }
  if (command instanceof ListPartsCommand) return { Parts: uploads.get(command.input.UploadId!)?.parts ?? [] };
  if (command instanceof CompleteMultipartUploadCommand) {
    completeCalls++; const remote = uploads.get(command.input.UploadId!); assert.ok(remote); objects.set(remote.key, remote);
    if (loseCompletionReply) { loseCompletionReply = false; throw Error("synthetic reply lost after success"); } return { ETag: "complete" };
  }
  if (command instanceof HeadObjectCommand) {
    const remote = objects.get(command.input.Key!); if (!remote) throw Object.assign(Error("missing"), { name: "NotFound" });
    return { ContentLength: remote.parts.reduce((sum, part) => sum + part.Size, 0), ContentType: remote.contentType, Metadata: remote.metadata };
  }
  if (command instanceof GetObjectCommand) {
    getCalls++; const remote = objects.get(command.input.Key!); assert.ok(remote?.source);
    return { Body: createReadStream(remote.source), ContentLength: (await stat(remote.source)).size, ContentType: remote.contentType, Metadata: remote.metadata };
  }
  if (command instanceof AbortMultipartUploadCommand) { uploads.delete(command.input.UploadId!); return {}; }
  if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
  throw Error("unexpected simulated provider operation");
} }) as never);
const { prisma } = await import("@/lib/prisma");
const { initializeDeliveryUpload, deliveryUploadStatus, completeDeliveryUpload, abortDeliveryUpload } = await import("@/lib/orders/delivery-direct-service");
const { processNextDeliveryValidation, cleanupDeliveryUploadSessions } = await import("@/lib/orders/delivery-direct-worker");
const actor: OrderActor = { id: randomUUID(), name: "Delivery QA", email: `delivery-direct-${randomUUID()}@example.invalid`, role: "ADMIN", status: "ACTIVE", emailVerified: true };
await owner.query('INSERT INTO users(id,email,role,status,"emailVerified","updatedAt") VALUES ($1,$2,\'ADMIN\',\'ACTIVE\',true,now())', [actor.id, actor.email]);
let orderSequence = Math.floor(Math.random() * 900000);
async function createOrder() {
  const id = randomUUID(), orderNumber = `LNX-2099-${String(++orderSequence).padStart(6, "0")}`;
  await owner.query(`INSERT INTO orders(id,"orderNumber","customerEmail",status,brief,"basePriceCents","totalCents",currency,"pricingVersion","updatedAt") VALUES ($1,$2,'qa@example.invalid','IN_PROGRESS','Local synthetic fixture',5000,5000,'EUR','2026-08-v1',now())`, [id, orderNumber]);
  await owner.query(`INSERT INTO payments(id,"orderId",provider,mode,status,"amountCents",currency,"pricingVersion","idempotencyKey","updatedAt","paidAt") VALUES ($1,$2,'STRIPE','TEST','SUCCEEDED',5000,'EUR','2026-08-v1',$3,now(),now())`, [randomUUID(), id, randomUUID()]);
  return orderNumber;
}
const temp = await mkdtemp("/private/tmp/lnx-delivery-runtime-files-");
async function wavFile(size: number) {
  const filename = `${temp}/${size}.wav`, header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(size - 8, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(size - 44, 40);
  const handle = await open(filename, "wx", 0o600); try { await handle.write(header); await handle.truncate(size); } finally { await handle.close(); }
  return filename;
}
async function uploaded(orderNumber: string, source: string, filename = "Été final master.wav") {
  const sizeBytes = (await stat(source)).size;
  const session = await initializeDeliveryUpload(actor, orderNumber, { filename, sizeBytes, mimeType: "" });
  const row = await prisma.orderDeliveryUploadSession.findUniqueOrThrow({ where: { id: session.sessionToken.split(".")[0] } });
  const remote = uploads.get(row.providerUploadId!)!; remote.source = source;
  remote.parts = Array.from({ length: session.partCount }, (_, i) => ({ PartNumber: i + 1, ETag: `part-${i + 1}`, Size: Math.min(DELIVERY_PART_BYTES, sizeBytes - i * DELIVERY_PART_BYTES) }));
  return session;
}
try {
  for (const size of [1024 * 1024, 68993468, DELIVERY_MAX_BYTES]) await check(`WAV complete validation ${size} bytes, Web never downloads source`, async () => {
    const order = await createOrder(), session = await uploaded(order, await wavFile(size)), before = getCalls;
    await Promise.all(Array.from({ length: 5 }, () => completeDeliveryUpload(actor, order, session.sessionToken)));
    assert.equal(getCalls, before); assert.equal((await deliveryUploadStatus(actor, order, session.sessionToken)).status, "QUARANTINE");
    await processNextDeliveryValidation();
    assert.equal((await deliveryUploadStatus(actor, order, session.sessionToken)).status, "READY");
    await completeDeliveryUpload(actor, order, session.sessionToken); await processNextDeliveryValidation();
    assert.equal(await prisma.orderAsset.count({ where: { assetId: session.sessionToken.split(".")[0] } }), 1);
  });
  await check("eight concurrent reservations only, ninth refused", async () => {
    const order = await createOrder(); const results = await Promise.allSettled(Array.from({ length: 9 }, () => initializeDeliveryUpload(actor, order, { filename: "master.wav", sizeBytes: 100, mimeType: "audio/wav" })));
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 8);
    for (const result of results) if (result.status === "fulfilled") await abortDeliveryUpload(actor, order, result.value.sessionToken);
    await cleanupDeliveryUploadSessions();
  });
  await check("cross-order, cross-Admin, expired, and over-limit fail closed", async () => {
    const order = await createOrder(), other = await createOrder(), session = await initializeDeliveryUpload(actor, order, { filename: "master.wav", sizeBytes: 100, mimeType: "audio/wav" });
    await assert.rejects(deliveryUploadStatus(actor, other, session.sessionToken));
    await assert.rejects(deliveryUploadStatus({ ...actor, id: randomUUID() }, order, session.sessionToken));
    await owner.query('UPDATE order_delivery_upload_sessions SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1', [session.sessionToken.split(".")[0]]);
    await assert.rejects(completeDeliveryUpload(actor, order, session.sessionToken), { code: "SESSION_EXPIRED" });
    const before = uploads.size;
    await assert.rejects(initializeDeliveryUpload(actor, order, { filename: "master.wav", sizeBytes: DELIVERY_MAX_BYTES + 1, mimeType: "audio/wav" }));
    assert.equal(uploads.size, before); await cleanupDeliveryUploadSessions();
  });
  await check("lost completion response recovered by worker HEAD without completing twice", async () => {
    const order = await createOrder(), session = await uploaded(order, await wavFile(2048)), before = completeCalls;
    loseCompletionReply = true; await completeDeliveryUpload(actor, order, session.sessionToken);
    await owner.query('UPDATE order_delivery_upload_sessions SET "leaseExpiresAt"=now()-interval \'1 second\' WHERE id=$1', [session.sessionToken.split(".")[0]]);
    await processNextDeliveryValidation(); assert.equal(completeCalls, before + 1);
    assert.equal((await deliveryUploadStatus(actor, order, session.sessionToken)).status, "READY");
  });
  await check("fake WAV rejected without asset attachment", async () => {
    const source = `${temp}/fake.wav`; await writeFile(source, "not audio");
    const order = await createOrder(), session = await uploaded(order, source);
    await completeDeliveryUpload(actor, order, session.sessionToken); await processNextDeliveryValidation();
    assert.equal((await deliveryUploadStatus(actor, order, session.sessionToken)).status, "REJECTED");
    assert.equal(await prisma.orderAsset.count({ where: { assetId: session.sessionToken.split(".")[0] } }), 0); await cleanupDeliveryUploadSessions();
  });
  await check("provider missing object, size mismatch, and revoked Admin fail closed", async () => {
    for (const fault of ["missing", "size", "admin"] as const) {
      const order = await createOrder(), session = await uploaded(order, await wavFile(4096 + ["missing", "size", "admin"].indexOf(fault) * 4));
      const id = session.sessionToken.split(".")[0];
      await completeDeliveryUpload(actor, order, session.sessionToken);
      const row = await prisma.orderDeliveryUploadSession.findUniqueOrThrow({ where: { id } });
      const remote = objects.get(row.storageKey)!;
      if (fault === "missing") objects.delete(row.storageKey);
      if (fault === "size") remote.parts[0]!.Size--;
      if (fault === "admin") await owner.query("UPDATE users SET role='MEMBER' WHERE id=$1", [actor.id]);
      await processNextDeliveryValidation();
      assert.notEqual((await prisma.orderDeliveryUploadSession.findUniqueOrThrow({ where: { id } })).status, "READY");
      assert.equal(await prisma.orderAsset.count({ where: { assetId: id } }), 0);
      if (fault === "admin") await owner.query("UPDATE users SET role='ADMIN' WHERE id=$1", [actor.id]);
      await abortDeliveryUpload(actor, order, session.sessionToken); await cleanupDeliveryUploadSessions();
    }
  });
  await check("abort never publishes and cleanup includes null error rows", async () => {
    const order = await createOrder(), session = await initializeDeliveryUpload(actor, order, { filename: "master.wav", sizeBytes: 100, mimeType: "" });
    await abortDeliveryUpload(actor, order, session.sessionToken); await cleanupDeliveryUploadSessions();
    const row = await prisma.orderDeliveryUploadSession.findUniqueOrThrow({ where: { id: session.sessionToken.split(".")[0] } });
    assert.equal(row.status, "ABORTED"); assert.equal(row.lastErrorCode, "CLEANED");
    await assert.rejects(completeDeliveryUpload(actor, order, session.sessionToken));
  });
  console.log(JSON.stringify({ status: "PASS", checks, postgres: "REAL", runtime: "NON_OWNER", storage: "SIMULATED_S3", productionMutation: false }));
} finally { await prisma.$disconnect(); await owner.end(); await rm(temp, { recursive: true, force: true }); }

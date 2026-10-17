import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/prisma";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { DIGITAL_AUDIO_UPLOAD_HOLDS, digitalAudioUploadHeld } from "@/lib/digital/audio-upload-holds";
import { DigitalError } from "@/lib/digital/domain";
import { createAudioFixture } from "../audio/fixture";
import { mkdir, mkdtemp, copyFile, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

test("protected ambiguous import is excluded from polling/recovery and explicit execution without mutation", async () => {
  const env = { ...process.env }, find = prisma.digitalUpload.findFirst, update = prisma.digitalUpload.updateMany, slot = prisma.digitalWorkSlot.updateMany;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" });
  for (const key of ["RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[key];
  const reads: Array<{ AND: unknown }> = []; let mutations = 0;
  prisma.digitalUpload.findFirst = (async (input: { where: { AND: unknown } }) => { reads.push(input.where); return null; }) as unknown as typeof find;
  prisma.digitalUpload.updateMany = (async () => { mutations++; throw new Error("No session write allowed"); }) as unknown as typeof update;
  prisma.digitalWorkSlot.updateMany = (async () => { mutations++; throw new Error("No lease claim allowed"); }) as unknown as typeof slot;
  try {
    const id = DIGITAL_AUDIO_UPLOAD_HOLDS[0];
    assert.equal(digitalAudioUploadHeld(id), true);
    assert.deepEqual(await processDigitalMedia({ uploadId: id }), { processed: false }); assert.equal(reads.length, 0);
    assert.deepEqual(await processDigitalMedia(), { processed: false }); assert.equal(reads.length, 2);
    for (const query of reads) assert.deepEqual(query.AND, [{ id: { notIn: [id] } }]);
    // Defence in depth even if a stale selection returns the held row.
    prisma.digitalUpload.findFirst = (async () => ({ id })) as unknown as typeof find;
    assert.deepEqual(await processDigitalMedia(), { processed: false }); assert.equal(mutations, 0);
  } finally {
    prisma.digitalUpload.findFirst = find; prisma.digitalUpload.updateMany = update; prisma.digitalWorkSlot.updateMany = slot;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
  }
});

test("monitor outage preserves the private original and requeues only the claimed session with its exact lease", async () => {
  const env = { ...process.env }, find = prisma.digitalUpload.findFirst, update = prisma.digitalUpload.updateMany, slot = prisma.digitalWorkSlot.updateMany;
  const parent = path.join(process.cwd(), ".private"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, "lnx-audio-failure-test-")), id = randomUUID(), trackId = randomUUID();
  const key = `digital/masters/${trackId}/${id}.wav`, source = path.join(root, "private", key);
  const fixture = await createAudioFixture({ seconds: 1, format: "wav" });
  const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  await mkdir(path.dirname(source), { recursive: true }); await copyFile(fixture.path, source);
  const before = await readFile(source), changes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const slots: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_STORAGE_DRIVER: "local", MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_LOCAL_PRIVATE_ROOT: path.join(root, "private"), MEDIA_LOCAL_PUBLIC_ROOT: path.join(root, "public"), DCN_WORK_ROOT: path.join(root, "work") });
  for (const k of ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "PAYMENT_DEPLOYMENT_ENV", "ORDER_UPLOAD_MODE"]) delete process.env[k];
  const session = { id, trackId, storageKey: key, sizeBytes: BigInt(before.length), filename: "source.wav", mimeType: "audio/wav", expectedVersion: 0 };
  let searches = 0;
  prisma.digitalUpload.findFirst = (async () => ++searches === 1 ? null : session) as unknown as typeof find;
  prisma.digitalUpload.updateMany = (async (input: typeof changes[number]) => { changes.push(input); return { count: 1 }; }) as unknown as typeof update;
  prisma.digitalWorkSlot.updateMany = (async (input: typeof slots[number]) => { slots.push(input); return { count: 1 }; }) as unknown as typeof slot;
  try {
    const result = await processDigitalMedia({ uploadId: id, afterSource: async () => { throw new DigitalError("WORKER_MONITOR_UNAVAILABLE"); } });
    assert.equal(result.ready, false); assert.equal(result.errorCode, "WORKER_MONITOR_UNAVAILABLE");
    assert.equal(digest(await readFile(source)), digest(before)); assert.deepEqual(await readFile(fixture.path), before);
    assert.equal(changes.length, 2); assert.equal(changes[0].data.status, "VALIDATING"); assert.equal(changes[1].data.status, "QUARANTINE");
    assert.equal(changes[1].where.id, id); assert.equal(changes[1].where.leaseToken, changes[0].data.leaseToken);
    assert.equal(changes[1].data.errorCode, "WORKER_MONITOR_UNAVAILABLE"); assert.equal(changes[1].data.leaseToken, null);
    assert.equal(slots.at(-1)?.where.leaseToken, changes[0].data.leaseToken); assert.equal(session.storageKey, key); assert.equal(session.expectedVersion, 0);
  } finally {
    prisma.digitalUpload.findFirst = find; prisma.digitalUpload.updateMany = update; prisma.digitalWorkSlot.updateMany = slot;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env);
    await fixture.cleanup(); await rm(root, { recursive: true, force: true });
  }
});

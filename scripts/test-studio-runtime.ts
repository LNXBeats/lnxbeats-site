/** New, disposable synthetic database only. No remote media, financial API,
 * historic order reconstruction or Production connection is permitted. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { createAudioFixture } from "@/tests/audio/fixture";
import type { OrderActor } from "@/lib/orders/domain";
import { initDigitalUpload, writeDigitalLocalPart, completeDigitalUpload } from "@/lib/digital/upload";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { listStudioJobs, mutateStudioJob, studioAudioAsset } from "@/lib/digital/studio-service";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { getMediaObject } from "@/lib/media/storage";

const rawTarget = new URL(process.env.DATABASE_URL ?? "");
// A new socket-only cluster is more isolated than loopback TCP. The shared URL
// guard deliberately stays unchanged; this single disposable test permits only
// its fixed database, fixed non-default port and fixed private Unix socket.
const isolatedSocket = rawTarget.hostname === "localhost" && rawTarget.port === "55546"
  && rawTarget.pathname === "/lnx_studio_synthetic_20261019" && rawTarget.username === "studio_owner"
  && rawTarget.searchParams.size === 1 && rawTarget.searchParams.get("host") === "/private/tmp/lnx-studio-qa-20261019";
const target = isolatedSocket ? rawTarget : assertSafeLocalPostgresUrl(rawTarget.toString());
assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
assert.equal(target.pathname, "/lnx_studio_synthetic_20261019");
assert.equal(process.env.LNX_STUDIO_ENABLED, "true"); assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local"); assert.notEqual(process.env.DCN_EXTERNAL_TEST_AUTHORIZED, "true");
const root = await mkdtemp("/private/tmp/lnx-dcn-studio-fixtures-"), prefix = `studio-${randomUUID()}`;
const results: Array<{ name: string; status: "PASS" | "FAIL" }> = [];
async function check(name: string, work: () => Promise<void>) {
  try { await work(); results.push({ name, status: "PASS" }); console.log(JSON.stringify({ name, status: "PASS" })); }
  catch (error) { results.push({ name, status: "FAIL" }); console.error(JSON.stringify({ name, status: "FAIL", code: error instanceof Error ? error.message : "UNKNOWN" })); throw error; }
}
const before = { orders: await prisma.digitalOrder.count(), entitlements: await prisma.digitalEntitlement.count(), documents: await prisma.digitalDocument.count() };
const admin = await prisma.user.create({ data: { email: `${prefix}@example.test`, role: "ADMIN", status: "ACTIVE", emailVerified: true, displayName: "QA Studio synthétique" } });
const actor: OrderActor = { id: admin.id, email: admin.email, role: "ADMIN", status: "ACTIVE", emailVerified: true, name: admin.displayName };
const project = await prisma.project.create({ data: { slug: prefix, title: "QA Studio — aucun album réel", type: "ALBUM", status: "DRAFT", publicVisible: false,
  catalogPosition: 900000 + Math.floor(Math.random() * 900000), tracks: { create: [
    { title: "Ça l’fait — 東京", position: 1, status: "DRAFT" }, { title: "MP3 privé uniquement", position: 2, status: "DRAFT" }, { title: "Reprise synthétique", position: 3, status: "DRAFT" },
    { title: "Fichier tronqué synthétique", position: 4, status: "DRAFT" },
  ] } }, include: { tracks: { orderBy: { position: "asc" } } } });
await prisma.digitalOffer.create({ data: { projectId: project.id, trackId: project.tracks[0].id, scope: "TRACK", priceCents: 129, active: false, rightsConfirmed: false } });
const prices = await prisma.digitalOffer.findMany({ where: { projectId: project.id } });
async function upload(trackId: string, format: "wav" | "mp3", truncate = false, previewStartMs = 0) {
  const fixture = await createAudioFixture({ seconds: 6, format, outputPath: path.join(root, `${randomUUID()}.${format}`) });
  const sourceBytes = await readFile(fixture.path), bytes = truncate ? sourceBytes.subarray(0, 80) : sourceBytes;
  const session = await initDigitalUpload(actor, trackId, { filename: `Ça l’fait — 東京.${format}`, mimeType: format === "wav" ? "audio/wav" : "audio/mpeg",
    sizeBytes: bytes.length, expectedVersion: 0, previewStartMs, studio: true });
  for (let number = 1; number <= session.partCount; number++) {
    const part = bytes.subarray((number - 1) * session.partSizeBytes, number * session.partSizeBytes);
    await writeDigitalLocalPart(actor, trackId, session.sessionToken, session.sessionToken.split(".")[0], number,
      new Request("http://127.0.0.1/qa", { method: "PUT", body: part, headers: { "content-length": String(part.length) } }));
  }
  await completeDigitalUpload(actor, trackId, session.sessionToken);
  return { id: session.sessionToken.split(".")[0], sha256: createHash("sha256").update(bytes).digest("hex") };
}
const wav = await upload(project.tracks[0].id, "wav", false, 1000);
try {
  await check("Effective non-owner Studio ACLs allow bounded workflow only, not identity rewrite or deletion", async () => {
    const role = `studio_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const owner = new Client({ connectionString: target.toString() }); await owner.connect();
    await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT,INSERT ON digital_studio_jobs,digital_studio_artifacts TO ${role}`);
    await owner.query(`GRANT UPDATE(status,phase,decision,binding,report,"errorCode","leaseToken","leaseUntil","sourceAssetId","sourceSha256","sourceLossy","publishedMasterId","allowExistingPurchases","updatedAt") ON digital_studio_jobs TO ${role}`);
    const runtimeUrl = new URL(target); runtimeUrl.username = role;
    const runtime = new Client({ connectionString: runtimeUrl.toString() }); await runtime.connect();
    try {
      await runtime.query("SELECT id FROM digital_studio_jobs LIMIT 1");
      await runtime.query("SELECT id FROM digital_studio_artifacts LIMIT 1");
      await runtime.query("UPDATE digital_studio_jobs SET phase=phase WHERE false");
      for (const query of ["UPDATE digital_studio_jobs SET title=title WHERE false", "DELETE FROM digital_studio_jobs WHERE false", "DELETE FROM digital_studio_artifacts WHERE false", "UPDATE digital_studio_artifacts SET role=role WHERE false", "UPDATE digital_orders SET status=status WHERE false"]) await assert.rejects(runtime.query(query), { code: "42501" });
    } finally { await runtime.end(); await owner.end(); }
  });
  await check("Multipart Studio opt-in queues one private job, rejects duplicate active upload", async () => {
    assert.equal(await prisma.digitalStudioJob.count({ where: { uploadId: wav.id } }), 1);
    await assert.rejects(initDigitalUpload(actor, project.tracks[0].id, { filename: "duplicate.wav", mimeType: "audio/wav", sizeBytes: 100, expectedVersion: 0, previewStartMs: 0, studio: true }), { code: "UPLOAD_ALREADY_ACTIVE" });
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: project.tracks[0].id } }), 0);
  });
  await check("Real existing audio worker generates 3 formats plus private original/preview/audition", async () => {
    const result = await processDigitalMedia({ uploadId: wav.id }); assert.equal(result.ready, true, JSON.stringify(result));
    const jobs = await listStudioJobs(actor, project.id), job = jobs.jobs.find(row => row.trackId === project.tracks[0].id)!;
    assert.equal(job.status, "READY"); assert.equal(job.approved, false); assert.equal(job.artifacts.length, 6);
    for (const item of job.artifacts) assert.equal((await studioAudioAsset(actor, job.id, item.role)).visibility, "PRIVATE");
    for (const role of ["MP3", "WAV_CD", "WAV_24"]) assert.equal(job.artifacts.find(item => item.role === role)?.metadataVerified, true);
    assert.ok(job.artifacts.find(item => item.role === "PREVIEW")!.durationMs! <= 5100);
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: job.trackId } }), 0);
  });
  const first = (await listStudioJobs(actor, project.id)).jobs.find(row => row.trackId === project.tracks[0].id)!;
  await check("Private audition HEAD and actual byte range work; forged non-admin fails", async () => {
    const asset = await studioAudioAsset(actor, first.id, "WAV_24");
    const head = await catalogAudioResponse(new Request("http://127.0.0.1/qa"), asset, "private, no-store", true); assert.equal(head.status, 200);
    const response = await catalogAudioResponse(new Request("http://127.0.0.1/qa", { headers: { range: "bytes=0-99" } }), asset, "private, no-store");
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 100);
    const member = await prisma.user.create({ data: { email: `${prefix}-member@example.test`, role: "MEMBER", status: "ACTIVE", emailVerified: true } });
    await assert.rejects(studioAudioAsset({ ...actor, id: member.id }, first.id, "WAV_24"), { code: "ADMIN_REQUIRED" });
  });
  await check("Approval needs real explicit listening field and exact current binding", async () => {
    await assert.rejects(mutateStudioJob(actor, { action: "approve", jobId: first.id, expectedBinding: first.binding, humanListened: false }), { code: "STUDIO_HUMAN_LISTENING_REQUIRED" });
    await assert.rejects(mutateStudioJob(actor, { action: "approve", jobId: first.id, expectedBinding: "a".repeat(64), humanListened: true }), { code: "STUDIO_VERSION_CHANGED" });
  });
  await check("Explicit synthetic approval appends one master only, keeps rights pending and prices/offers unchanged", async () => {
    const input = { action: "approve", jobId: first.id, expectedBinding: first.binding, humanListened: true };
    await mutateStudioJob(actor, input); await mutateStudioJob(actor, input);
    const master = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: first.trackId }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } });
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: first.trackId } }), 1);
    assert.equal(master.previewStartMs, 1000);
    assert.equal(master.masterAsset.rightsStatus, "PENDING"); assert.equal(master.mp3Asset?.rightsStatus, "PENDING"); assert.ok(master.previewAsset?.durationMs && master.previewAsset.durationMs <= 60000);
    assert.deepEqual(await prisma.digitalOffer.findMany({ where: { projectId: project.id } }), prices);
    assert.equal(await prisma.digitalEvent.count({ where: { kind: "STUDIO_FILES_APPROVED", details: { path: ["jobId"], equals: first.id } } }), 1);
  });
  await check("Original checksum and immutable version/assets survive approval", async () => {
    const original = await studioAudioAsset(actor, first.id, "ORIGINAL"), bytes = new Uint8Array(await new Response((await getMediaObject(original)).body).arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), wav.sha256);
    await assert.rejects(prisma.digitalStudioJob.update({ where: { id: first.id }, data: { title: "wrong title" } }));
    await assert.rejects(prisma.asset.update({ where: { id: original.id }, data: { checksumSha256: "a".repeat(64) } }));
  });
  const mp3 = await upload(project.tracks[1].id, "mp3");
  await check("MP3 source gets honest lossy 3-format private candidates, never automatic commercial master", async () => {
    const result = await processDigitalMedia({ uploadId: mp3.id }); assert.equal(result.ready, true, JSON.stringify(result));
    const job = (await listStudioJobs(actor, project.id)).jobs.find(row => row.trackId === project.tracks[1].id)!;
    assert.equal(job.sourceLossy, true);
    await mutateStudioJob(actor, { action: "approve", jobId: job.id, expectedBinding: job.binding, humanListened: true });
    const state = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(state.decision, "APPROVED"); assert.equal(state.publishedMasterId, null); assert.equal(state.errorCode, "STUDIO_LOSSY_COMMERCIAL_POLICY_REQUIRED");
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: job.trackId } }), 0);
  });
  const restart = await upload(project.tracks[2].id, "wav");
  await processDigitalMedia({ uploadId: restart.id });
  const retryJob = (await listStudioJobs(actor, project.id)).jobs.find(row => row.trackId === project.tracks[2].id)!;
  await check("Reject/retry is append-only, repeated retry reuses attempt, original upload reused", async () => {
    await mutateStudioJob(actor, { action: "reject", jobId: retryJob.id, expectedBinding: retryJob.binding });
    const input = { action: "retry", jobId: retryJob.id, expectedBinding: retryJob.binding };
    const one = await mutateStudioJob(actor, input), two = await mutateStudioJob(actor, input);
    assert.equal("jobId" in one && one.jobId, "jobId" in two && two.jobId);
    assert.equal(await prisma.digitalStudioJob.count({ where: { uploadId: restart.id } }), 2);
    assert.equal((await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: retryJob.id } })).decision, "REJECTED");
    assert.equal((await processDigitalMedia({ uploadId: restart.id })).ready, true);
    assert.equal(await prisma.digitalUpload.count({ where: { trackId: retryJob.trackId } }), 1);
  });
  await check("Unimplemented legacy restore is explicit fail-closed, financial and historic counts unchanged", async () => {
    await assert.rejects(mutateStudioJob(actor, { action: "restore", jobId: first.id, expectedBinding: first.binding }), { code: "STUDIO_RESTORE_REQUIRES_RELEASE_REVIEW" });
    assert.deepEqual({ orders: await prisma.digitalOrder.count(), entitlements: await prisma.digitalEntitlement.count(), documents: await prisma.digitalDocument.count() }, before);
  });
  await check("Truncated synthetic upload fails closed with original private bytes/session intact and no automatic retry", async () => {
    const broken = await upload(project.tracks[3].id, "wav", true), result = await processDigitalMedia({ uploadId: broken.id });
    assert.equal(result.ready, false);
    const session = await prisma.digitalUpload.findUniqueOrThrow({ where: { id: broken.id } });
    assert.equal(session.status, "REJECTED");
    const job = await prisma.digitalStudioJob.findFirstOrThrow({ where: { uploadId: broken.id } });
    assert.equal(job.status, "FAILED"); assert.equal(job.phase, "ERROR");
    assert.equal(job.sourceSha256, broken.sha256);
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: job.trackId } }), 0);
    const original = await getMediaObject({ storageBackend: "LOCAL", storageProvider: "local", visibility: "PRIVATE", storageKey: session.storageKey });
    const bytes = new Uint8Array(await new Response(original.body).arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), broken.sha256);
    assert.equal((await processDigitalMedia({ uploadId: broken.id })).processed, false);
  });
  console.log(JSON.stringify({ status: "PASS", tests: results, projectId: project.id, root, externalCalls: 0, financialCalls: 0, syntheticOnly: true }));
} finally { await prisma.$disconnect(); }

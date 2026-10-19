/** Independent synthetic QA only. Existing-source preparation never approves a
 * master, creates an order, changes an offer, or resets a historical upload. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";
import { putMediaObject, getMediaObject } from "@/lib/media/storage";
import { studioExistingMasterInclude, studioExistingSourceSnapshot, prepareExistingStudioSources, processNextStudioExistingSource } from "@/lib/digital/studio-existing-source";
import { studioExistingMetadataHash } from "@/lib/digital/studio-existing-source-policy";
import { studioHash, studioEnabled } from "@/lib/digital/studio-policy";
import { listStudioJobs, mutateStudioJob } from "@/lib/digital/studio-service";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import type { OrderActor } from "@/lib/orders/domain";

const target = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["postgres:", "postgresql:"].includes(target.protocol)); assert.equal(target.hostname, "localhost"); assert.equal(target.port, "55546");
assert.equal(target.pathname, "/lnx_studio_synthetic_20261019"); assert.equal(target.password, "");
assert.equal(target.searchParams.size, 1); assert.equal(target.searchParams.get("host"), "/private/tmp/lnx-studio-qa-20261019");
assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.LNX_STUDIO_ENABLED, "true");
assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local"); assert.ok(!Object.keys(process.env).some(key => /PAYPAL|STRIPE|RESEND|SECRET|TOKEN|S3_/.test(key)));
const runtime = process.env.STUDIO_EXISTING_FIXTURE;
const results: Array<{ name: string; status: "PASS" }> = [];
async function check(name: string, work: () => Promise<void>) { await work(); const value = { name, status: "PASS" as const }; results.push(value); console.log(JSON.stringify(value)); }
if (!runtime) {
  assert.equal(target.username, "studio_owner");
  const prefix = `studio-existing-${randomUUID()}`, directory = await mkdtemp("/private/tmp/lnx-dcn-studio-existing-fixtures-");
  const actorUser = await prisma.user.create({ data: { email: `${prefix}@example.test`, displayName: "Source existante — synthétique", role: "ADMIN", status: "ACTIVE", emailVerified: true } });
  const project = await prisma.project.create({ data: { title: "QA Studio sources existantes — aucun catalogue réel", slug: prefix, type: "ALBUM", status: "DRAFT", publicVisible: false,
    catalogPosition: 8_000_000 + Math.floor(Math.random() * 1_000_000), tracks: { create: [{ title: "Source déjà présente — 東京", position: 1, status: "DRAFT" }, { title: "Source tronquée synthétique", position: 2, status: "DRAFT" }] } }, include: { tracks: { orderBy: { position: "asc" } } } });
  const fixture = await createAudioFixture({ format: "wav", seconds: 3, outputPath: path.join(directory, "original.wav") });
  const previewFixture = await createAudioFixture({ format: "mp3", seconds: 3, outputPath: path.join(directory, "preview.mp3") });
  const previewBytes = await readFile(previewFixture.path), previewSha = createHash("sha256").update(previewBytes).digest("hex");
  const original = await readFile(fixture.path), masterIds: string[] = [];
  for (const [index, track] of project.tracks.entries()) {
    const id = randomUUID(), bytes = index ? original.subarray(0, 80) : original, sha = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `digital/masters/${track.id}/${id}.wav`;
    const stored = await putMediaObject({ scope: "private", key: storageKey, body: bytes, contentLength: bytes.length, contentType: "audio/wav", checksumSha256: sha });
    await prisma.asset.create({ data: { id, type: "AUDIO", visibility: "PRIVATE", storageKey, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider,
      filename: `${track.title}.wav`, mimeType: "audio/wav", sizeBytes: BigInt(bytes.length), durationMs: 3000, checksumSha256: sha, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
    const previewId = randomUUID(), previewKey = `digital/studio/${randomUUID()}/${previewId}.mp3`;
    const previewStored = await putMediaObject({ scope: "private", key: previewKey, body: previewBytes, contentLength: previewBytes.length, contentType: "audio/mpeg", checksumSha256: previewSha });
    await prisma.asset.create({ data: { id: previewId, type: "AUDIO_PREVIEW", visibility: "PUBLIC", storageKey: previewKey, storageBackend: previewStored.storageBackend,
      storageProvider: previewStored.storageProvider, filename: `${track.title}.mp3`, mimeType: "audio/mpeg", sizeBytes: BigInt(previewBytes.length), durationMs: 3000,
      checksumSha256: previewSha, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
    const master = await prisma.digitalMaster.create({ data: { trackId: track.id, version: 1, masterAssetId: id, previewAssetId: previewId,
      previewDurationMs: 3000, codec: "wav", status: "READY", previewStartMs: 250 } });
    masterIds.push(master.id);
    await prisma.digitalOffer.create({ data: { projectId: project.id, trackId: track.id, scope: "TRACK", priceCents: 129, active: false, rightsConfirmed: false } });
  }
  const role = `studio_existing_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const owner = new Client({ connectionString: target.toString() }); await owner.connect();
  try {
    await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT ON users,projects,tracks,credits,assets,digital_masters,digital_uploads,digital_studio_jobs,digital_studio_artifacts,digital_work_slots,digital_events,digital_entitlements TO ${role}`);
    await owner.query(`GRANT INSERT ON assets,digital_studio_jobs,digital_studio_artifacts,digital_events TO ${role}`);
    await owner.query(`GRANT UPDATE(status,phase,decision,binding,report,"errorCode","leaseToken","leaseUntil","sourceAssetId","sourceSha256","sourceLossy","publishedMasterId","allowExistingPurchases","updatedAt") ON digital_studio_jobs TO ${role}`);
    await owner.query(`GRANT UPDATE("jobId","leaseToken","leaseUntil") ON digital_work_slots TO ${role}`);
  } finally { await owner.end(); }
  const existingAssetIds = (await prisma.asset.findMany({ select: { id: true } })).map(row => row.id);
  const existingJobIds = (await prisma.digitalStudioJob.findMany({ select: { id: true } })).map(row => row.id);
  const existingEventIds = (await prisma.digitalEvent.findMany({ select: { id: true } })).map(row => row.id);
  const snapshot = async () => studioHash({ masters: await prisma.digitalMaster.findMany({ orderBy: { id: "asc" } }), offers: await prisma.digitalOffer.findMany({ orderBy: { id: "asc" } }),
    uploads: await prisma.digitalUpload.findMany({ orderBy: { id: "asc" } }), orders: await prisma.digitalOrder.findMany({ orderBy: { id: "asc" } }),
    lines: await prisma.digitalOrderLine.findMany({ orderBy: { id: "asc" } }), acquisitions: await prisma.digitalEntitlement.findMany({ orderBy: { id: "asc" } }),
    tracks: await prisma.track.findMany({ orderBy: { id: "asc" } }), assets: await prisma.asset.findMany({ where: { id: { in: existingAssetIds } }, orderBy: { id: "asc" } }),
    jobs: await prisma.digitalStudioJob.findMany({ where: { id: { in: existingJobIds } }, orderBy: { id: "asc" } }), events: await prisma.digitalEvent.findMany({ where: { id: { in: existingEventIds } }, orderBy: { id: "asc" } }) });
  const before = await snapshot(), runtimeUrl = new URL(target); runtimeUrl.username = role;
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test-studio-existing-source-runtime.ts"], { cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: runtimeUrl.toString(), STUDIO_EXISTING_FIXTURE: JSON.stringify({ actorId: actorUser.id, masterIds, projectId: project.id }) }, stdio: ["ignore", "inherit", "inherit"] });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }); assert.equal(code, 0);
  assert.equal(await snapshot(), before);
  console.log(JSON.stringify({ status: "PASS", protectedCatalogueUploadsOriginalsOrdersAcquisitionsAndEarlierStudioJobs: "IDENTICAL", roleNonOwner: true,
    syntheticMasterIds: masterIds, providerCalls: 0, productionAccess: false, newOrders: 0, automaticApprovals: 0, oldFilesRemoved: 0 }));
  await prisma.$disconnect();
} else {
  assert.match(target.username, /^studio_existing_test_[a-f0-9]{16}$/);
  const ids = JSON.parse(runtime) as { actorId: string; masterIds: string[]; projectId: string };
  assert.equal(ids.masterIds.length, 2);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ids.actorId } }); assert.ok(user.email.startsWith("studio-existing-") && user.email.endsWith("@example.test"));
  const actor: OrderActor = { id: user.id, email: user.email, role: "ADMIN", status: "ACTIVE", emailVerified: true, name: user.displayName };
  const masters = await Promise.all(ids.masterIds.map(id => prisma.digitalMaster.findUniqueOrThrow({ where: { id }, include: studioExistingMasterInclude })));
  const inputs = masters.map(master => { const source = studioExistingSourceSnapshot(master); return { masterId: master.id, expectedVersion: master.version,
    sourceAssetId: master.masterAssetId, sourceSha256: master.masterAsset.checksumSha256!, expectedMetadataHash: studioExistingMetadataHash(source) }; });
  try {
    await check("Non-owner runtime cannot change masters, historic uploads, original assets or artifact identities", async () => {
      await assert.rejects(prisma.digitalMaster.update({ where: { id: masters[0].id }, data: { status: "READY" } }));
      await assert.rejects(prisma.asset.update({ where: { id: masters[0].masterAssetId }, data: { filename: "not-allowed.wav" } }));
      await assert.rejects(prisma.digitalUpload.updateMany({ where: { trackId: masters[0].trackId }, data: { status: "REJECTED" } }));
      await assert.rejects(prisma.digitalStudioArtifact.deleteMany({ where: { jobId: randomUUID() } }));
    });
    let goodId = "", badId = "";
    await check("Exact existing sources enqueue idempotently without any upload or source copy", async () => {
      const first = await prepareExistingStudioSources(actor, { sources: inputs }), second = await prepareExistingStudioSources(actor, { sources: inputs });
      goodId = first.jobs[0].jobId; badId = first.jobs[1].jobId;
      assert.deepEqual(second.jobs.map(row => row.jobId), first.jobs.map(row => row.jobId)); assert.ok(second.jobs.every(row => row.reused));
      for (const jobId of [goodId, badId]) { const job = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: jobId } }); assert.equal(job.uploadId, null); assert.equal(job.decision, "PENDING"); assert.equal(job.publishedMasterId, null); }
      assert.equal(await prisma.digitalUpload.count({ where: { trackId: { in: masters.map(row => row.trackId) } } }), 0);
      const view = await listStudioJobs(actor, ids.projectId); assert.equal(view.existingSources.length, 2);
      await assert.rejects(prepareExistingStudioSources(actor, { sources: [{ ...inputs[0], sourceSha256: "b".repeat(64) }] }), { code: "STUDIO_SOURCE_CHANGED" });
    });
    await check("Held or explicit missing upload does not process a different queued existing-source job", async () => {
      assert.equal((await processDigitalMedia({ uploadId: "d7af5226-f1b6-4da3-ba87-9e96f0ab11d8" })).processed, false);
      assert.equal((await processDigitalMedia({ uploadId: randomUUID() })).processed, false);
      const cancelled = new AbortController(); cancelled.abort(); assert.equal((await processNextStudioExistingSource({ jobId: goodId, signal: cancelled.signal })).processed, false);
      process.env.LNX_STUDIO_ENABLED = "false";
      try { assert.equal(studioEnabled(), false); await assert.rejects(processNextStudioExistingSource({ jobId: goodId }), { code: "STUDIO_DISABLED" }); }
      finally { process.env.LNX_STUDIO_ENABLED = "true"; }
      assert.equal((await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: goodId } })).status, "QUEUED");
    });
    await check("Existing worker shares audio slots and enforces one existing-source process across concurrent invocations", async () => {
      let entered!: () => void, release!: () => void;
      const atSource = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
      const running = processNextStudioExistingSource({ jobId: goodId, afterSource: async () => { entered(); await resume; } });
      await atSource;
      try { assert.equal((await processNextStudioExistingSource({ jobId: badId })).processed, false);
        assert.equal(await prisma.digitalWorkSlot.count({ where: { jobId: goodId, leaseUntil: { gt: new Date() } } }), 1); }
      finally { release(); }
      const result = await running; assert.equal(result.ready, true, JSON.stringify(result));
      const job = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: goodId }, include: { artifacts: { include: { asset: true } } } });
      assert.equal(job.status, "READY"); assert.equal(job.decision, "PENDING"); assert.equal(job.publishedMasterId, null); assert.ok(job.binding);
      assert.equal(job.artifacts.find(row => row.role === "ORIGINAL")?.assetId, masters[0].masterAssetId);
      for (const role of ["MP3", "WAV_CD", "WAV_24"]) { const item = job.artifacts.find(row => row.role === role)!; assert.equal(item.metadataVerified, true); assert.equal(item.asset.visibility, "PRIVATE"); }
      assert.equal((job.report as { preview: { startMs: number } }).preview.startMs, 250);
      assert.equal(await prisma.digitalWorkSlot.count({ where: { jobId: goodId } }), 0);
    });
    await check("Truncated existing source fails closed with its original, master and session absence intact", async () => {
      const result = await processNextStudioExistingSource({ jobId: badId }); assert.equal(result.ready, false); assert.ok(result.errorCode);
      const failed = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: badId } }); assert.equal(failed.status, "FAILED"); assert.equal(failed.decision, "PENDING");
      assert.equal(failed.publishedMasterId, null); assert.equal(await prisma.digitalStudioArtifact.count({ where: { jobId: badId } }), 0);
      const bytes = new Uint8Array(await new Response((await getMediaObject(masters[1].masterAsset)).body).arrayBuffer());
      assert.equal(createHash("sha256").update(bytes).digest("hex"), inputs[1].sourceSha256); assert.equal(bytes.length, 80);
      assert.equal((await processNextStudioExistingSource({ jobId: badId })).processed, false);
    });
    await check("Explicit retry appends one same-source attempt and stale lease recovers without an automatic retry loop", async () => {
      const failed = (await listStudioJobs(actor, ids.projectId)).jobs.find(row => row.id === badId)!;
      const input = { action: "retry", jobId: badId, expectedBinding: failed.binding };
      const first = await mutateStudioJob(actor, input), second = await mutateStudioJob(actor, input);
      assert.ok("jobId" in first && "jobId" in second); assert.equal(first.jobId, second.jobId);
      const next = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: first.jobId } }); assert.equal(next.attempt, 2); assert.equal(next.sourceAssetId, masters[1].masterAssetId);
      await prisma.digitalStudioJob.update({ where: { id: next.id }, data: { status: "PROCESSING", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() - 1000) } });
      assert.equal((await processNextStudioExistingSource({ jobId: next.id })).ready, false);
      assert.equal((await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: next.id } })).status, "FAILED");
      assert.equal(await prisma.digitalUpload.count({ where: { trackId: { in: masters.map(row => row.trackId) } } }), 0);
      assert.equal(await prisma.digitalWorkSlot.count({ where: { jobId: next.id } }), 0);
    });
    console.log(JSON.stringify({ status: "PASS", results, fixtureOnly: true, roleNonOwner: true, newApprovals: 0, newOrders: 0, productionAccess: false, providerCalls: 0 }));
  } finally { await prisma.$disconnect(); }
}

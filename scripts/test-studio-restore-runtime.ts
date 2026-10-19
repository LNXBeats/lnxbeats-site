/** Standalone qualification of private-candidate preparation. This script does
 * not call or replace the disabled HTTP restore branch. Fixed disposable QA DB
 * only; its approved source is a pre-existing, explicitly synthetic audio test. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { copyStudioRestoreArtifact, prepareStudioRestore, processStudioRestoreJob } from "@/lib/digital/studio-restore";
import { studioRestoreCurrentBinding } from "@/lib/digital/studio-restore-policy";
import { studioBinding, studioHash } from "@/lib/digital/studio-policy";
import { claimDigitalSlot, releaseDigitalSlot } from "@/lib/digital/work-slots";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "localhost"); assert.equal(url.port, "55546"); assert.equal(url.pathname, "/lnx_studio_synthetic_20261019");
assert.equal(url.username, "studio_owner"); assert.equal(url.searchParams.get("host"), "/private/tmp/lnx-studio-qa-20261019"); assert.equal(url.searchParams.size, 1);
assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
assert.equal(process.env.LNX_STUDIO_ENABLED, "true"); assert.equal(process.env.DCN_NEW_PAYMENTS_ENABLED, "false"); assert.equal(process.env.PAYMENTS_ENABLED, "false");
assert.ok(process.env.STUDIO_RESTORE_TEST_OUTPUT?.includes("/STABILISATION_20261019/admin/"));
const results: Array<{ name: string; status: "PASS" }> = [];
async function check(name: string, work: () => Promise<void>) { await work(); results.push({ name, status: "PASS" }); console.log(JSON.stringify({ name, status: "PASS" })); }
const tableNames = ["digital_masters", "digital_offers", "digital_orders", "digital_order_lines", "digital_entitlements", "digital_documents", "digital_download_tickets", "projects", "tracks", "credits"] as const;
async function fingerprints() {
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const table of tableNames) {
    const rows = await prisma.$queryRawUnsafe<Array<{ row: string }>>(`SELECT row_to_json(t)::text AS row FROM public."${table}" t ORDER BY id`);
    result[table] = { count: rows.length, sha256: studioHash(rows.map(row => row.row)) };
  }
  return result;
}
const include = { artifacts: { include: { asset: true }, orderBy: { role: "asc" as const } }, upload: { select: { previewStartMs: true } } } as const;
const available = await prisma.digitalStudioJob.findMany({ where: { status: "READY", decision: "APPROVED", sourceLossy: false, publishedMasterId: { not: null }, title: "Ça l’fait — 東京" }, include, orderBy: { createdAt: "desc" }, take: 10 });
const source = available.find(job => job.report && typeof job.report === "object" && !Array.isArray(job.report) && "preview" in job.report);
assert.ok(source, "A previously qualified synthetic WAV fixture with preview proof is required; do not substitute a real track");
const track = await prisma.track.findUniqueOrThrow({ where: { id: source.trackId }, include: { credits: { orderBy: { id: "asc" } }, project: { include: { credits: { orderBy: { id: "asc" } } } } } });
assert.match(track.project.slug, /^studio-[0-9a-f-]{36}$/); assert.equal(track.project.publicVisible, false);
assert.equal(track.title, "Ça l’fait — 東京");
const original = source.artifacts.find(file => file.role === "ORIGINAL")!; assert.ok(original.asset.durationMs && original.asset.durationMs <= 10_000);
const user = await prisma.user.findUniqueOrThrow({ where: { id: source.actorId } }); assert.equal(user.role, "ADMIN"); assert.equal(user.status, "ACTIVE"); assert.equal(user.emailVerified, true);
const actor: OrderActor = { id: user.id, email: user.email, role: "ADMIN", status: "ACTIVE", emailVerified: true, name: user.displayName };
const sourceHashBefore = studioHash(source), oldIds = new Set(source.artifacts.map(file => file.assetId));
let slot: Awaited<ReturnType<typeof claimDigitalSlot>> = null;
try {
  // Fixture setup only: append a distinct synthetic current master so the older
  // approved synthetic version is genuinely not the current version anymore.
  // No old row, commercial offer, acquisition or approval is changed.
  const fixtureNamespace = randomUUID(), copied = new Map<string, { source: typeof source.artifacts[number]; stored: Awaited<ReturnType<typeof copyStudioRestoreArtifact>> }>();
  for (const role of ["MP3", "WAV_24", "PREVIEW"]) {
    const file = source.artifacts.find(item => item.role === role)!;
    const stored = await copyStudioRestoreArtifact({ source: file.asset, jobId: fixtureNamespace, assetId: randomUUID(), role, signal: new AbortController().signal });
    copied.set(role, { source: file, stored });
    await prisma.asset.create({ data: { id: stored.assetId, type: role === "PREVIEW" ? "AUDIO_PREVIEW" : "AUDIO", visibility: role === "PREVIEW" ? "PUBLIC" : "PRIVATE",
      storageKey: stored.storageKey, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, filename: file.asset.filename, mimeType: file.asset.mimeType,
      sizeBytes: file.asset.sizeBytes, durationMs: file.asset.durationMs, checksumSha256: stored.sha256, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
  }
  const latest = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: source.trackId }, orderBy: { version: "desc" } });
  const fixtureCurrent = await prisma.digitalMaster.create({ data: { trackId: source.trackId, version: latest.version + 1,
    masterAssetId: copied.get("WAV_24")!.stored.assetId, mp3AssetId: copied.get("MP3")!.stored.assetId, mp3BitrateKbps: 320,
    encoderVersion: "lnx-beats-studio-v1", previewAssetId: copied.get("PREVIEW")!.stored.assetId, previewStartMs: source.previewStartMs ?? source.upload?.previewStartMs ?? 0,
    previewDurationMs: copied.get("PREVIEW")!.source.asset.durationMs, codec: "wav", status: "READY" } });
  const metadata = { credits: [...track.project.credits, ...track.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
    ...(track.project.releaseDate ? { date: track.project.releaseDate.toISOString().slice(0, 10) } : {}) };
  const currentBinding = studioRestoreCurrentBinding({ id: fixtureCurrent.id, trackId: source.trackId, version: fixtureCurrent.version, masterAssetId: fixtureCurrent.masterAssetId,
    masterSha256: copied.get("WAV_24")!.stored.sha256, title: track.title, album: track.project.type === "ALBUM" ? track.project.title : null, metadata });
  assert.equal(studioHash(metadata), studioHash(source.metadata)); assert.notEqual(fixtureCurrent.id, source.publishedMasterId);
  const before = await fingerprints(), request = { jobId: source.id, expectedBinding: source.binding!, expectedCurrentBinding: currentBinding, confirmReplacement: true, confirmExistingPurchases: false };
  await check("A stale current binding refuses private preparation before creating a job", async () => {
    const count = await prisma.digitalStudioJob.count();
    await assert.rejects(prepareStudioRestore(actor, { ...request, expectedCurrentBinding: "0".repeat(64) }), { message: "STUDIO_VERSION_CHANGED" });
    assert.equal(await prisma.digitalStudioJob.count(), count);
  });
  const prepared = await prepareStudioRestore(actor, request);
  await check("The standalone helper enqueues only a private PENDING candidate with no current master switch", async () => {
    const job = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: prepared.jobId } });
    assert.equal(job.status, "QUEUED"); assert.equal(job.decision, "PENDING"); assert.equal(job.publishedMasterId, null); assert.equal(job.uploadId, null);
    assert.equal(job.sourceAssetId, original.assetId); assert.equal(job.baseMasterId, fixtureCurrent.id); assert.equal(job.expectedVersion, fixtureCurrent.version);
    assert.deepEqual(await fingerprints(), before);
  });
  await check("A repeated explicit preparation reuses the same candidate and event", async () => {
    const duplicate = await prepareStudioRestore(actor, request); assert.equal(duplicate.jobId, prepared.jobId); assert.equal(duplicate.duplicate, true);
    assert.equal(await prisma.digitalEvent.count({ where: { kind: "STUDIO_RESTORE_PREPARATION_REQUESTED", details: { path: ["jobId"], equals: prepared.jobId } } }), 1);
  });
  slot = await claimDigitalSlot("audio", prepared.jobId); assert.ok(slot, "An existing bounded audio slot must be free");
  await prisma.digitalStudioJob.update({ where: { id: prepared.jobId }, data: { status: "PROCESSING", phase: "ANALYZING", leaseToken: slot.leaseToken, leaseUntil: new Date(Date.now() + 15 * 60_000) } });
  await processStudioRestoreJob({ id: prepared.jobId }, { leaseToken: slot.leaseToken, signal: new AbortController().signal, slot });
  const restored = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: prepared.jobId }, include });
  await check("Exact restored bytes are private and require a NEW human listening decision", async () => {
    assert.equal(restored.status, "READY"); assert.equal(restored.decision, "PENDING"); assert.equal(restored.publishedMasterId, null); assert.equal(restored.allowExistingPurchases, false);
    assert.equal(restored.binding, studioBinding(restored, restored.artifacts));
    assert.equal(restored.artifacts.find(file => file.role === "ORIGINAL")!.assetId, original.assetId);
    for (const role of ["MP3", "WAV_CD", "WAV_24", "PREVIEW"]) {
      const prior: typeof source.artifacts[number] = source!.artifacts.find(file => file.role === role)!, next = restored.artifacts.find(file => file.role === role)!;
      assert.equal(next.asset.visibility, "PRIVATE"); assert.notEqual(next.assetId, prior.assetId); assert.ok(!oldIds.has(next.assetId));
      assert.equal(next.asset.checksumSha256, prior.asset.checksumSha256); assert.equal(next.asset.sizeBytes, prior.asset.sizeBytes); assert.equal(next.asset.filename, prior.asset.filename);
    }
    assert.equal(await prisma.digitalEvent.count({ where: { kind: "STUDIO_FILES_APPROVED", details: { path: ["jobId"], equals: prepared.jobId } } }), 0);
    const report = restored.report as { studioRestore: { newHumanListening: string; humanApprovalRequired: boolean; previousApprovalCopied: boolean } };
    assert.equal(report.studioRestore.newHumanListening, "NOT_PERFORMED"); assert.equal(report.studioRestore.humanApprovalRequired, true); assert.equal(report.studioRestore.previousApprovalCopied, false);
  });
  await check("Current master, prices, orders, documents, tickets, rights and source approval fingerprints stay identical", async () => {
    assert.deepEqual(await fingerprints(), before);
    assert.equal(studioHash(await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: source!.id }, include })), sourceHashBefore);
    assert.equal((await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: source!.trackId }, orderBy: { version: "desc" } })).id, fixtureCurrent.id);
  });
  const after = await fingerprints();
  await writeFile(process.env.STUDIO_RESTORE_TEST_OUTPUT!, JSON.stringify({ status: "PASS", scope: "FIXED_LOCAL_SYNTHETIC_DATABASE_ONLY", database: url.pathname.slice(1), port: 55546,
    authorization: "Accord groupé du propriétaire : « Oui, ces évolutions ciblées avec ces protections » ; qualification des « retours de version » limitée ici à une nouvelle candidate privée.",
    noHttpRestoreActivation: true, noProductionAccess: true, noPaymentApi: true, noMasterSwitchByHelpers: true, noNewHumanApproval: true,
    fixtureSetup: { sourceJobId: source.id, sourcePublishedMasterId: source.publishedMasterId, appendedSyntheticCurrentMasterId: fixtureCurrent.id, syntheticCurrentVersion: fixtureCurrent.version },
    preparedJobId: prepared.jobId, statusAfterProcessing: restored.status, decisionAfterProcessing: restored.decision, publishedMasterId: restored.publishedMasterId,
    before, after, results, evidence: restored.report }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "PASS", tests: results.length, jobId: prepared.jobId, decision: restored.decision, publishedMasterId: restored.publishedMasterId }));
} finally { if (slot) await releaseDigitalSlot(slot); await prisma.$disconnect(); }

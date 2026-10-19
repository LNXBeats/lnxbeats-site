import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { generateDigitalSourceMp3Preview, validateDigitalMp3 } from "@/lib/digital/audio";
import { isAuthorizedMp3OnlySource, MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "@/lib/digital/mp3-only-policy";
import { createAudioFixture } from "../audio/fixture";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
test("MP3-only permission requires the exact owner-authorized track, original checksum and byte count", () => {
  const asset = { checksumSha256: MP3_ONLY_SOURCE.sourceSha256, sizeBytes: MP3_ONLY_SOURCE.sourceBytes };
  assert.equal(isAuthorizedMp3OnlySource(MP3_ONLY_SOURCE.trackId, asset), true);
  assert.equal(isAuthorizedMp3OnlySource(MP3_ONLY_SOURCE.trackId, { ...asset, sizeBytes: BigInt(asset.sizeBytes) }), true);
  for (const [trackId, candidate] of [[undefined, asset], [randomUUID(), asset], [MP3_ONLY_SOURCE.trackId, { ...asset, checksumSha256: "f".repeat(64) }],
    [MP3_ONLY_SOURCE.trackId, { ...asset, checksumSha256: null }], [MP3_ONLY_SOURCE.trackId, { ...asset, sizeBytes: null }],
    [MP3_ONLY_SOURCE.trackId, { ...asset, sizeBytes: asset.sizeBytes - 1 }]] as const) assert.equal(isAuthorizedMp3OnlySource(trackId, candidate), false);
  assert.equal(Object.isFrozen(MP3_ONLY_SOURCE), true); assert.equal(Object.isFrozen(MP3_ONLY_SOURCE.formats), true);
});

test("MP3-source preview remains under sixty seconds, strips artwork and never rewrites the complete original", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-dcn-mp3-preview-"), source = path.join(root, "source.mp3"), preview = path.join(root, "preview.mp3");
  try {
    await createAudioFixture({ seconds: 65, format: "mp3", outputPath: source });
    const before = digest(await readFile(source)), controller = new AbortController();
    const result = await generateDigitalSourceMp3Preview(source, preview, 1000, controller.signal);
    assert.ok(result.previewDurationMs > 59000 && result.previewDurationMs <= 60000);
    const checked = await validateDigitalMp3(preview, controller.signal, { durationMs: 59900, bitrateKbps: 192 });
    assert.equal(checked.bitrateKbps, 192); assert.ok(Math.abs(result.durationMs - 65000) <= 100);
    assert.equal(digest(await readFile(source)), before);
    await assert.rejects(generateDigitalSourceMp3Preview(source, preview, 66000, controller.signal), { code: "INVALID_EXCERPT" });
    controller.abort(); await assert.rejects(generateDigitalSourceMp3Preview(source, preview, 0, controller.signal), { code: "LEASE_LOST" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Optional private fixture is never committed. All DB methods are doubles, storage is a new
// bounded local directory, and no QA/Production connection or network call is made.
const exactFixture = process.env.DCN_MP3_ONLY_SOURCE_FIXTURE;
async function importFixture(options: { otherTrack?: boolean; projectType?: "ALBUM"; changedProject?: boolean; duplicate?: boolean; staleVersion?: boolean; denyActor?: boolean; leaseLost?: boolean } = {}) {
  assert.ok(exactFixture);
  const original = await readFile(exactFixture);
  assert.equal(original.length, MP3_ONLY_SOURCE.sourceBytes); assert.equal(digest(original), MP3_ONLY_SOURCE.sourceSha256);
  const root = await mkdtemp("/private/tmp/lnx-dcn-mp3-pipeline-"), id = randomUUID(), trackId = options.otherTrack ? randomUUID() : MP3_ONLY_SOURCE.trackId;
  const storageKey = `digital/masters/${trackId}/${id}.mp3`, privateSource = path.join(root, "private", storageKey), env = { ...process.env };
  const saved = { uploadFind: prisma.digitalUpload.findFirst, uploadUpdate: prisma.digitalUpload.updateMany, slotUpdate: prisma.digitalWorkSlot.updateMany,
    projectFind: prisma.project.findUnique, assetFind: prisma.asset.findFirst, transaction: prisma.$transaction };
  const assets: Array<Record<string, unknown>> = [], masters: Array<Record<string, unknown>> = [], events: Array<Record<string, unknown>> = [], changes: Array<Record<string, unknown>> = [];
  const project = { type: options.projectType ?? "SINGLE", tracks: [{ id: trackId }] };
  const session = { id, actorId: randomUUID(), trackId, storageKey, filename: "LENTEMENT.mp3", mimeType: "audio/mpeg", sizeBytes: BigInt(original.length), expectedVersion: 0, previewStartMs: 0 };
  const tx = { $queryRaw: async () => [{ locked: true }],
    digitalUpload: { findFirst: async () => options.leaseLost ? null : session, update: async ({ data }: { data: Record<string, unknown> }) => { changes.push(data); return data; } },
    digitalWorkSlot: { findFirst: async () => ({ id: "audio-0" }) }, user: { findUnique: async () => ({ role: options.denyActor ? "MEMBER" : "ADMIN", status: "ACTIVE", emailVerified: true }) },
    project: { findUnique: async () => options.changedProject ? { ...project, tracks: [] } : project },
    digitalMaster: { findFirst: async (input: { where: { masterAsset?: unknown } }) => input.where.masterAsset ? options.duplicate ? { id: randomUUID() } : null : options.staleVersion ? { version: 1 } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { masters.push(data); return { id: randomUUID(), ...data }; } },
    asset: { create: async ({ data }: { data: Record<string, unknown> }) => { assets.push(data); return data; } }, track: { update: async () => ({}) },
    digitalEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; } } };
  try {
    await mkdir(path.dirname(privateSource), { recursive: true }); await copyFile(exactFixture, privateSource);
    Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_STORAGE_DRIVER: "local", MEDIA_DEPLOYMENT_ENV: "test",
      MEDIA_LOCAL_PRIVATE_ROOT: path.join(root, "private"), MEDIA_LOCAL_PUBLIC_ROOT: path.join(root, "public"), DCN_WORK_ROOT: path.join(root, "work") });
    for (const key of ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "PAYMENT_DEPLOYMENT_ENV", "ORDER_UPLOAD_MODE"]) delete process.env[key];
    let searches = 0;
    prisma.digitalUpload.findFirst = (async () => ++searches === 1 ? null : session) as unknown as typeof saved.uploadFind;
    prisma.digitalUpload.updateMany = (async ({ data }: { data: Record<string, unknown> }) => { changes.push(data); return { count: 1 }; }) as unknown as typeof saved.uploadUpdate;
    prisma.digitalWorkSlot.updateMany = (async () => ({ count: 1 })) as unknown as typeof saved.slotUpdate;
    prisma.project.findUnique = (async () => project) as unknown as typeof saved.projectFind;
    prisma.asset.findFirst = (async () => null) as unknown as typeof saved.assetFind;
    prisma.$transaction = (async (callback: (db: typeof tx) => unknown) => callback(tx)) as unknown as typeof saved.transaction;
    const result = await processDigitalMedia({ uploadId: id });
    assert.equal(digest(await readFile(privateSource)), MP3_ONLY_SOURCE.sourceSha256);
    assert.equal(digest(await readFile(exactFixture)), MP3_ONLY_SOURCE.sourceSha256);
    return { result, assets, masters, events, changes };
  } finally {
    prisma.digitalUpload.findFirst = saved.uploadFind; prisma.digitalUpload.updateMany = saved.uploadUpdate; prisma.digitalWorkSlot.updateMany = saved.slotUpdate;
    prisma.project.findUnique = saved.projectFind; prisma.asset.findFirst = saved.assetFind; prisma.$transaction = saved.transaction;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
    await rm(root, { recursive: true, force: true });
  }
}
test("exact authorized MP3 becomes a technical version plus excerpt, with no WAV, full re-encoding or automatic approval", { skip: !exactFixture, timeout: 30000 }, async () => {
  const { result, assets, masters, events } = await importFixture();
  assert.equal(result.ready, true); assert.equal("mp3Only" in result && result.mp3Only, true);
  assert.equal(masters.length, 1); assert.equal(assets.length, 2);
  assert.deepEqual([masters[0].codec, masters[0].status, masters[0].mp3AssetId, masters[0].mp3BitrateKbps, masters[0].encoderVersion], ["mp3", "READY", null, null, null]);
  assert.equal(assets[0].visibility, "PRIVATE"); assert.equal(assets[0].mimeType, "audio/mpeg"); assert.equal(assets[0].checksumSha256, MP3_ONLY_SOURCE.sourceSha256);
  assert.ok(Number(assets[1].durationMs) <= 60000); assert.equal(assets.every(a => a.rightsStatus === "PENDING"), true);
  assert.equal(events[0].kind, "MP3_ONLY_SOURCE_VALIDATED");
  const details = events[0].details as Record<string, unknown>;
  assert.equal(details.policy, MP3_ONLY_SOURCE_POLICY); assert.equal(details.fullSourceReencoded, false); assert.equal(details.wavAvailable, false);
  assert.equal(details.artisticApproval, false); assert.equal(details.offerActivated, false); assert.equal(details.rightsReview, "PENDING");
});
test("same MP3 on another track remains a private quarantined draft", { skip: !exactFixture, timeout: 30000 }, async () => {
  const { result, assets, masters, events } = await importFixture({ otherTrack: true });
  assert.equal(result.ready, true); assert.equal("draftOnly" in result && result.draftOnly, true);
  assert.equal(masters[0].status, "QUARANTINED"); assert.equal(assets.length, 1); assert.equal(assets[0].visibility, "PRIVATE");
  assert.equal(events[0].kind, "MP3_SOURCE_DRAFT_VALIDATED");
});
test("MP3-only scope, concurrent project changes, versions and duplicate checks fail closed before association", { skip: !exactFixture, timeout: 30000 }, async () => {
  for (const [options, expected] of [[{ projectType: "ALBUM" }, "MP3_ONLY_SOURCE_SCOPE"], [{ changedProject: true }, "MP3_ONLY_SOURCE_SCOPE"],
    [{ staleVersion: true }, "MASTER_VERSION_CONFLICT"], [{ duplicate: true }, "DUPLICATE_MASTER_REVIEW_REQUIRED"],
    [{ denyActor: true }, "ADMIN_REQUIRED"], [{ leaseLost: true }, "LEASE_LOST"]] as const) {
    const { result, assets, masters, events, changes } = await importFixture(options);
    assert.equal(result.ready, false); assert.equal("errorCode" in result && result.errorCode, expected);
    assert.equal(masters.length, 0); assert.equal(assets.length, 0); assert.equal(events.length, 0);
    assert.equal(changes.at(-1)?.status, expected === "LEASE_LOST" ? "QUARANTINE" : "REJECTED");
  }
});

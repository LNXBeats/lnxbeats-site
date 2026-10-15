/** Fresh synthetic IDs only in the dedicated commercial-France LOCAL copy. No PSP, mail, R2 or global worker queue. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeDigitalLocalPostgresUrl } from "@/lib/digital/local-review-database";
import { hashPassword } from "@/lib/auth/password";

for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key)) delete process.env[key];
const config = JSON.parse(await readFile(".private/dcn-france-commercial-config.json", "utf8")) as Record<string, string>;
const ownerConfig = JSON.parse(await readFile(".private/dcn-consolidation-owner-config.json", "utf8")) as Record<string, string>;
const target = assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55473"); assert.equal(target.pathname, "/lnx_dcn_france_commercial_test_20261015");
assert.equal(target.username, "dcn_runtime_a"); assert.equal(target.searchParams.get("options"), "-c timezone=UTC");
assert.equal(config.MEDIA_STORAGE_DRIVER, "local"); assert.equal(config.EMAIL_PROVIDER, "capture"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
assert.equal(config.DCN_MODE, "TEST");
for (const key of Object.keys(config)) assert.doesNotMatch(key, /STRIPE|PAYPAL|RESEND|S3|R2|AWS|SMTP/i);
const ownerTarget = assertSafeDigitalLocalPostgresUrl(ownerConfig.DATABASE_URL);
assert.equal(ownerTarget.hostname, "127.0.0.1"); assert.equal(ownerTarget.port, "55473"); assert.notEqual(ownerTarget.username, target.username);
ownerTarget.pathname = target.pathname; ownerTarget.searchParams.set("options", "-c timezone=UTC");
Object.assign(process.env, config, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_EXTERNAL_TEST_AUTHORIZED: "false", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_LOCAL_REVIEW_AUTHORIZED: "true" });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "No external fetch is permitted.");
  return nativeFetch(input, init);
};
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerTarget.toString() }) });
const { prisma } = await import("@/lib/prisma");
const { initDigitalUpload, writeDigitalLocalPart, completeDigitalUpload } = await import("@/lib/digital/upload");
const { processDigitalMedia } = await import("@/lib/digital/media-worker");
const { putMediaObject, getMediaObject } = await import("@/lib/media/storage");
const { digitalCommercialAudioReady } = await import("@/lib/digital/formats");
const { loadDigitalRightsReviews } = await import("@/lib/digital/rights-review-service");
const { auth } = await import("@/lib/auth");
const previewRoute = await import("@/app/api/admin/digital/previews/[id]/route");
const coverRoute = await import("@/app/api/admin/digital/covers/[id]/route");
const publicPreviewRoute = await import("@/app/media/digital/previews/[id]/route");
const publicCoverRoute = await import("@/app/media/catalog/[assetId]/route");
const runId = randomUUID(), base = config.AUTH_URL, password = randomBytes(32).toString("base64url");
const checks: Record<string, string> = {};
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const measurements: unknown[] = [];
const directory = await mkdtemp("/private/tmp/lnx-dcn-admin-proof-");
const fullMaster = { masterAsset: true, mp3Asset: true, previewAsset: true } as const;

try {
  const timezone = await prisma.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone')::text AS timezone`;
  assert.equal(timezone[0].timezone, "UTC");
  const unchangedIds = (await owner.digitalMaster.findMany({ select: { id: true } })).map(master => master.id);
  const beforeCopiedMasters = serialize(await owner.digitalMaster.findMany({ where: { id: { in: unchangedIds } }, orderBy: { id: "asc" }, include: fullMaster }));
  const admin = await owner.user.create({ data: { email: `dcn-admin-proof-${runId}@example.invalid`, displayName: "Admin QA édition privée", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() } });
  const member = await owner.user.create({ data: { email: `dcn-member-proof-${runId}@example.invalid`, displayName: "Membre QA sans accès Admin", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() } });
  for (const user of [admin, member]) await owner.account.create({ data: { userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(password) } });
  const actor = { id: admin.id, email: admin.email, name: admin.displayName, role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
  const position = 10_000_000 + Number.parseInt(runId.slice(0, 6), 16);
  const project = await owner.project.create({ data: { slug: `dcn-edition-privee-${runId}`, title: "QA — Édition privée avant publication", subtitle: "Single synthétique inédit — aucun tarif de lancement", type: "SINGLE", status: "DRAFT", publicVisible: false, catalogPosition: position,
    shortDescription: "Préparation locale uniquement : extrait écoutable en Admin sans publier le single.", credits: { create: { name: "Générateur audio synthétique QA", role: "PRODUCER", confidence: "CONFIRMED" } }, tracks: { create: { title: "QA — Le début de l’extrait change", position: 1, status: "ANNOUNCED" } } }, include: { tracks: true } });
  const track = project.tracks[0]!;
  const sentinelProject = await owner.project.create({ data: { slug: `dcn-dedupe-witness-${runId}`, title: "QA — Témoin privé de déduplication", type: "PROJECT", status: "DRAFT", publicVisible: false, catalogPosition: position + 1, tracks: { create: { title: "QA — Autre piste refusée", position: 1, status: "UNLISTED" } } }, include: { tracks: true } });
  const sourcePath = `${directory}/master-synthetique.wav`;
  assert.ok(ffmpegStatic);
  await promisify(execFile)(ffmpegStatic, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=293:sample_rate=44100:duration=65.321", "-ac", "2", "-c:a", "pcm_s24le", "-metadata", `title=PRIVATE SYNTHETIC ${runId}`, "-y", sourcePath], { timeout: 120_000, maxBuffer: 65536 });
  const sourceBytes = await readFile(sourcePath), sourceHash = hash(sourceBytes), size = (await stat(sourcePath)).size;
  async function enqueue(trackId: string, expectedVersion: number, previewStartMs: number) {
    const session = await initDigitalUpload(actor, trackId, { filename: "master-synthetique.wav", mimeType: "audio/wav", sizeBytes: size, expectedVersion, previewStartMs, replaceConfirmed: expectedVersion > 0 });
    const uploadId = session.sessionToken.split(".")[0]!;
    for (let part = 1; part <= session.partCount; part++) {
      const start = (part - 1) * session.partSizeBytes, body = Readable.toWeb(createReadStream(sourcePath, { start, end: Math.min(size, start + session.partSizeBytes) - 1 }));
      await writeDigitalLocalPart(actor, trackId, session.sessionToken, uploadId, part, new Request(`${base}/qa-upload`, { method: "PUT", body, duplex: "half" } as RequestInit));
    }
    await completeDigitalUpload(actor, trackId, session.sessionToken);
    return uploadId;
  }
  async function ingest(uploadId: string) {
    const result = await processDigitalMedia({ uploadId }); measurements.push(result);
    const upload = await prisma.digitalUpload.findUniqueOrThrow({ where: { id: uploadId } });
    assert.ok(["READY", "REJECTED"].includes(upload.status), `Bounded scoped processing did not finish: ${upload.status}/${upload.errorCode}`);
    return upload;
  }
  const firstId = await enqueue(track.id, 0, 0); assert.equal((await ingest(firstId)).status, "READY");
  const first = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: track.id, version: 1 }, include: fullMaster });
  assert.equal(digitalCommercialAudioReady(first), true); assert.equal(first.masterAsset.checksumSha256, sourceHash);
  const beforeFirst = serialize(first);
  const sentinelId = await enqueue(sentinelProject.tracks[0]!.id, 0, 0);
  assert.equal((await prisma.digitalUpload.findUniqueOrThrow({ where: { id: sentinelId } })).status, "QUARANTINE");
  const revisedId = await enqueue(track.id, 1, 12_345); assert.equal((await ingest(revisedId)).status, "READY");
  assert.equal((await prisma.digitalUpload.findUniqueOrThrow({ where: { id: sentinelId } })).status, "QUARANTINE");
  checks.SCOPED_AUDIO_WORKER_LEAVES_OTHER_UPLOAD_UNTOUCHED = "PASS";
  const revised = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: track.id, version: 2 }, include: fullMaster });
  assert.equal(digitalCommercialAudioReady(revised), true); assert.equal(revised.previewStartMs, 12_345); assert.ok(revised.previewDurationMs! <= 60_000);
  assert.equal(revised.masterAsset.checksumSha256, sourceHash); assert.notEqual(first.masterAssetId, revised.masterAssetId); assert.notEqual(first.mp3AssetId, revised.mp3AssetId); assert.notEqual(first.previewAssetId, revised.previewAssetId);
  for (const asset of [revised.masterAsset, revised.mp3Asset!, revised.previewAsset!]) assert.equal(asset.rightsStatus, "PENDING");
  for (const master of [first, revised]) {
    for (const asset of [master.masterAsset, master.mp3Asset!, master.previewAsset!]) {
      const bytes = new Uint8Array(await new Response((await getMediaObject(asset)).body).arrayBuffer());
      assert.equal(hash(bytes), asset.checksumSha256); assert.equal(bytes.length, Number(asset.sizeBytes));
    }
  }
  assert.equal(serialize(await prisma.digitalMaster.findUniqueOrThrow({ where: { id: first.id }, include: fullMaster })), beforeFirst);
  assert.notEqual((await loadDigitalRightsReviews(prisma, [revised]))[0].status, "APPROVED");
  const event = await prisma.digitalEvent.findFirstOrThrow({ where: { kind: "MASTER_VALIDATED", details: { path: ["trackId"], equals: track.id } }, orderBy: { createdAt: "desc" } });
  const details = event.details as { revalidation?: { kind?: string; previousMasterId?: string; previousPreviewStartMs?: number; previewStartMs?: number }; rightsReview?: string };
  assert.equal(details.revalidation?.kind, "ADDITIVE_EXCERPT_REVISION"); assert.equal(details.revalidation.previousMasterId, first.id); assert.equal(details.revalidation.previousPreviewStartMs, 0); assert.equal(details.revalidation.previewStartMs, 12_345); assert.equal(details.rightsReview, "PENDING");
  checks.REAL_SAME_WAV_NEW_EXCERPT_NEW_IDENTITIES_AND_AUDIT = "PASS"; checks.PREVIOUS_VERSION_AND_PHYSICAL_BYTES_UNCHANGED = "PASS"; checks.NEW_VERSION_REQUIRES_NEW_RIGHTS_REVIEW = "PASS";
  const unchanged = await enqueue(track.id, 2, 12_345); assert.equal((await ingest(unchanged)).errorCode, "DUPLICATE_MASTER_REVIEW_REQUIRED");
  assert.equal((await ingest(sentinelId)).errorCode, "DUPLICATE_MASTER_REVIEW_REQUIRED");
  await assert.rejects(initDigitalUpload(actor, track.id, { filename: "master-synthetique.wav", mimeType: "audio/wav", sizeBytes: size, expectedVersion: 1, previewStartMs: 20_000, replaceConfirmed: true }), { code: "MASTER_VERSION_CONFLICT" });
  assert.equal(await prisma.digitalMaster.count({ where: { trackId: track.id } }), 2);
  checks.UNCHANGED_CROSS_TRACK_AND_STALE_REIMPORT_REFUSED = "PASS";
  const coverId = randomUUID(), coverBytes = await sharp({ create: { width: 480, height: 480, channels: 3, background: "#29221a" } }).composite([{ input: Buffer.from('<svg width="480" height="480"><rect x="35" y="35" width="410" height="410" fill="none" stroke="#dfb85b" stroke-width="3"/><text x="240" y="205" fill="#dfb85b" font-family="sans-serif" font-size="54" text-anchor="middle">QA</text><text x="240" y="260" fill="white" font-family="sans-serif" font-size="22" text-anchor="middle">ÉDITION PRIVÉE</text><text x="240" y="302" fill="#dfb85b" font-family="sans-serif" font-size="18" text-anchor="middle">SYNTHÉTIQUE</text></svg>') }]).webp().toBuffer();
  const coverKey = `catalog/covers/${coverId}.webp`, storedCover = await putMediaObject({ scope: "public", key: coverKey, body: coverBytes, contentLength: coverBytes.length, contentType: "image/webp", checksumSha256: hash(coverBytes) });
  await owner.asset.create({ data: { id: coverId, type: "COVER", storageKey: coverKey, storageBackend: storedCover.storageBackend, storageProvider: storedCover.storageProvider, visibility: "PUBLIC", filename: "qa-cover.webp", mimeType: "image/webp", sizeBytes: BigInt(coverBytes.length), checksumSha256: hash(coverBytes), width: 480, height: 480, rightsStatus: "CLEARED", confidence: "CONFIRMED", alt: "Cover synthétique QA de l’édition privée" } });
  await owner.projectAsset.create({ data: { projectId: project.id, assetId: coverId, role: "COVER" } });
  async function cookie(email: string) {
    const response = await auth.handler(new Request(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email, password }) }));
    assert.equal(response.status, 200, "Fresh synthetic QA sign-in failed.");
    const value = response.headers.getSetCookie().map(part => part.split(";")[0]).join("; "); assert.ok(value); return value;
  }
  const adminCookie = await cookie(admin.email), memberCookie = await cookie(member.email);
  const request = (kind: string, id: string, authCookie?: string, method = "GET", range?: string) => new Request(`${base}/api/admin/digital/${kind}/${id}`, { method, headers: { ...(authCookie ? { cookie: authCookie } : {}), ...(range ? { range } : {}) } });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const preview = await previewRoute.GET(request("previews", revised.previewAssetId!, adminCookie), params(revised.previewAssetId!));
  assert.equal(preview.status, 200); assert.equal(preview.headers.get("cache-control"), "private, no-store"); assert.equal(hash(new Uint8Array(await preview.arrayBuffer())), revised.previewAsset!.checksumSha256);
  const range = await previewRoute.GET(request("previews", revised.previewAssetId!, adminCookie, "GET", "bytes=0-15"), params(revised.previewAssetId!));
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 16); assert.equal(range.headers.get("cache-control"), "private, no-store");
  assert.equal((await previewRoute.HEAD(request("previews", revised.previewAssetId!, adminCookie, "HEAD"), params(revised.previewAssetId!))).status, 200);
  assert.equal((await previewRoute.GET(request("previews", revised.previewAssetId!), params(revised.previewAssetId!))).status, 401);
  assert.equal((await previewRoute.GET(request("previews", revised.previewAssetId!, memberCookie), params(revised.previewAssetId!))).status, 403);
  for (const assetId of [revised.masterAssetId, revised.mp3AssetId!]) assert.equal((await previewRoute.GET(request("previews", assetId, adminCookie), params(assetId))).status, 404);
  assert.equal((await publicPreviewRoute.GET(new Request(`${base}/media/digital/previews/${revised.previewAssetId}`), params(revised.previewAssetId!))).status, 404);
  const cover = await coverRoute.GET(request("covers", coverId, adminCookie), params(coverId));
  assert.equal(cover.status, 200); assert.equal(cover.headers.get("cache-control"), "private, no-store"); assert.equal(hash(new Uint8Array(await cover.arrayBuffer())), hash(coverBytes));
  assert.equal((await coverRoute.GET(request("covers", coverId), params(coverId))).status, 401);
  assert.equal((await coverRoute.GET(request("covers", coverId, memberCookie), params(coverId))).status, 403);
  assert.equal((await publicCoverRoute.GET(new Request(`${base}/media/catalog/${coverId}`), { params: Promise.resolve({ assetId: coverId }) })).status, 404);
  checks.PRIVATE_DRAFT_PREVIEW_GET_HEAD_RANGE_AND_EXACT_BYTES = "PASS"; checks.NON_ADMIN_AND_ANONYMOUS_DENIED = "PASS"; checks.COMPLETE_FILES_NEVER_SERVED_AS_EXCERPTS = "PASS"; checks.DRAFT_COVER_PRIVATE_AND_PUBLIC_MEDIA_REMAIN_CLOSED = "PASS";
  assert.equal(await prisma.digitalOffer.count({ where: { projectId: project.id } }), 0);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status, "DRAFT");
  assert.equal(serialize(await owner.digitalMaster.findMany({ where: { id: { in: unchangedIds } }, orderBy: { id: "asc" }, include: fullMaster })), beforeCopiedMasters);
  checks.NO_OFFER_NO_PRICE_NO_PUBLICATION_AND_COPIED_MASTERS_UNCHANGED = "PASS";
  await mkdir("output/dcn-france-commercial", { recursive: true });
  const credentialsPath = `.private/dcn-admin-preparation-credentials-${runId}.json`, proofPath = `output/dcn-france-commercial/admin-preparation-runtime-${runId}.json`;
  await writeFile(credentialsPath, JSON.stringify({ runId, adminEmail: admin.email, memberEmail: member.email, password, slug: project.slug, projectId: project.id, trackId: track.id, coverId, previewAssetId: revised.previewAssetId, adminCookie, memberCookie }), { mode: 0o600, flag: "wx" });
  const proof = { localOnly: true, database: target.pathname.slice(1), runId, checks, measurements, adminUrl: `${base}/admin/musique/${project.slug}#edition-preview`, projectId: project.id, trackId: track.id, firstMasterId: first.id, revisedMasterId: revised.id, sourceChecksum: sourceHash, privateCredentialsFile: credentialsPath, providerCalls: 0, realEmails: 0, routeVerification: "IN_PROCESS_REAL_ROUTE_HANDLERS_REQUEST_RESPONSE_AUTH_DATABASE_LOCAL_STORAGE_NOT_BROWSER_HTTP", readyProduction: false };
  await writeFile(proofPath, JSON.stringify(proof, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...proof, proofPath }));
} finally { await owner.$disconnect(); await prisma.$disconnect(); globalThis.fetch = nativeFetch; }

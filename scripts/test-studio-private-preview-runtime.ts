/** One fresh synthetic fixture, no historical fixture mutation or provider call. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { createAudioFixture } from "@/tests/audio/fixture";
import { initDigitalUpload, writeDigitalLocalPart, completeDigitalUpload } from "@/lib/digital/upload";
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { listStudioJobs, mutateStudioJob } from "@/lib/digital/studio-service";
import { createPublicMediaSignedUrl, headMediaObject, isPrivateStudioStorageKey } from "@/lib/media/storage";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { digitalPublicPreviewAllowed } from "@/lib/digital/public-preview";
import { GET as publicPreview } from "@/app/media/digital/previews/[id]/route";
import { studioHash } from "@/lib/digital/studio-policy";

const target = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
assert.equal(target.hostname, "localhost"); assert.equal(target.port, "55546"); assert.equal(target.username, "studio_owner");
assert.equal(target.pathname, "/lnx_studio_synthetic_20261019"); assert.equal(target.searchParams.size, 1);
assert.equal(target.searchParams.get("host"), "/private/tmp/lnx-studio-qa-20261019");
assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.LNX_STUDIO_ENABLED, "true");
assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local"); assert.notEqual(process.env.DCN_EXTERNAL_TEST_AUTHORIZED, "true");
const publicRoot = path.resolve(process.env.MEDIA_LOCAL_PUBLIC_ROOT!), privateRoot = path.resolve(process.env.MEDIA_LOCAL_PRIVATE_ROOT!);
assert.notEqual(publicRoot, privateRoot);
async function files(root: string) {
  try { return (await readdir(root, { recursive: true })).filter(name => /\.(?:mp3|wav)$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
const results: Array<{ name: string; status: "PASS" }> = [];
async function check(name: string, work: () => Promise<void>) { await work(); results.push({ name, status: "PASS" }); console.log(JSON.stringify({ name, status: "PASS" })); }
const financialBefore = { orders: await prisma.digitalOrder.count(), entitlements: await prisma.digitalEntitlement.count(), documents: await prisma.digitalDocument.count(), offers: studioHash(await prisma.digitalOffer.findMany({ orderBy: { id: "asc" } })) };
const publicBefore = await files(publicRoot), prefix = `studio-private-preview-${randomUUID()}`;
const owner = await prisma.user.create({ data: { email: `${prefix}@example.test`, displayName: "QA preview privée", role: "ADMIN", status: "ACTIVE", emailVerified: true } });
const actor: OrderActor = { id: owner.id, email: owner.email, name: owner.displayName, role: "ADMIN", status: "ACTIVE", emailVerified: true };
const project = await prisma.project.create({ data: { slug: prefix, title: "QA aperçu privé — synthétique uniquement", type: "SINGLE", status: "PUBLISHED", publicVisible: true,
  catalogPosition: 3000000 + Math.floor(Math.random() * 900000), tracks: { create: { title: "QA aperçu privé — zéro vente", position: 1, status: "RELEASED" } } }, include: { tracks: true } });
const track = project.tracks[0], directory = await mkdtemp("/private/tmp/lnx-dcn-studio-preview-test-");
const fixture = await createAudioFixture({ seconds: 4, format: "wav", outputPath: path.join(directory, "source.wav") });
const bytes = await readFile(fixture.path), session = await initDigitalUpload(actor, track.id, { filename: "source.wav", mimeType: "audio/wav", sizeBytes: bytes.length, expectedVersion: 0, previewStartMs: 0, studio: true });
await writeDigitalLocalPart(actor, track.id, session.sessionToken, session.sessionToken.split(".")[0], 1, new Request("http://127.0.0.1/qa", { method: "PUT", body: bytes, headers: { "content-length": String(bytes.length) } }));
await completeDigitalUpload(actor, track.id, session.sessionToken);
const processed = await processDigitalMedia({ uploadId: session.sessionToken.split(".")[0] }); assert.equal(processed.ready, true, JSON.stringify(processed));
const job = (await listStudioJobs(actor, project.id)).jobs[0], input = { action: "approve", jobId: job.id, expectedBinding: job.binding, humanListened: true };
const privateBefore = await files(privateRoot), gate = new Client({ connectionString: target.toString() });
await gate.connect();
try {
  await check("A failed promotion leaves only a private orphan, never a public object", async () => {
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`catalog-project:${project.id}`]);
    const pending = mutateStudioJob(actor, input).then(() => ({ ok: true as const, error: null }), error => ({ ok: false as const, error }));
    let copied = false;
    for (let attempt = 0; attempt < 60 && !copied; attempt++) {
      copied = (await files(privateRoot)).some(key => key.startsWith(`digital/studio/${job.id}/`) && !privateBefore.includes(key));
      if (!copied) await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!copied) { await gate.query("ROLLBACK"); await pending; assert.fail("Private promotion copy was not observed before the bounded timeout"); }
    await gate.query('UPDATE tracks SET title=$1 WHERE id=$2', [`${track.title} — conflit synthétique`, track.id]);
    await gate.query("COMMIT");
    const result = await pending; assert.equal(result.ok, false); assert.equal(result.error?.code, "STUDIO_METADATA_CHANGED");
    await prisma.track.update({ where: { id: track.id }, data: { title: track.title } });
    assert.equal(await prisma.digitalMaster.count({ where: { trackId: track.id } }), 0);
    const stored = new Set((await prisma.asset.findMany({ select: { storageKey: true } })).map(asset => asset.storageKey));
    const orphans = (await files(privateRoot)).filter(key => key.startsWith(`digital/studio/${job.id}/`) && !privateBefore.includes(key) && !stored.has(key));
    assert.equal(orphans.length, 1); assert.ok(orphans.every(isPrivateStudioStorageKey));
    assert.deepEqual(await files(publicRoot), publicBefore);
  });
  await check("Approved logical preview remains physically private, streams through the authorised response and refuses a public signature", async () => {
    await mutateStudioJob(actor, input);
    const master = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: track.id }, include: { masterAsset: true, mp3Asset: true, previewAsset: true } });
    const preview = master.previewAsset!;
    assert.equal(preview.visibility, "PUBLIC"); assert.equal(preview.rightsStatus, "PENDING"); assert.ok(isPrivateStudioStorageKey(preview.storageKey));
    assert.equal((await headMediaObject(preview)).contentLength, Number(preview.sizeBytes));
    const response = await catalogAudioResponse(new Request("http://127.0.0.1/authorised-preview"), preview, "private, no-store");
    assert.equal(response.status, 200); assert.equal(createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex"), preview.checksumSha256);
    assert.throws(() => createPublicMediaSignedUrl(preview, { expiresInSeconds: 60 }), /application authorization/);
    assert.equal(await digitalPublicPreviewAllowed(prisma, master), false);
    assert.equal((await publicPreview(new Request(`http://127.0.0.1/media/digital/previews/${preview.id}`), { params: Promise.resolve({ id: preview.id }) })).status, 404);
    assert.equal(await prisma.digitalEvent.count({ where: { kind: "EXCERPT_SELECTION_RECORDED", details: { path: ["binding", "masterId"], equals: master.id } } }), 0);
    assert.deepEqual(await files(publicRoot), publicBefore);
  });
  await check("Private-preview safety change leaves all offers, acquisition fixtures and financial documents unchanged", async () => {
    assert.deepEqual({ orders: await prisma.digitalOrder.count(), entitlements: await prisma.digitalEntitlement.count(), documents: await prisma.digitalDocument.count(), offers: studioHash(await prisma.digitalOffer.findMany({ orderBy: { id: "asc" } })) }, financialBefore);
  });
  console.log(JSON.stringify({ status: "PASS", results, newPublicAudioObjects: 0, orphanScope: "PRIVATE", externalCalls: 0, financialCalls: 0, syntheticOnly: true }));
} finally { await gate.end(); await prisma.$disconnect(); }

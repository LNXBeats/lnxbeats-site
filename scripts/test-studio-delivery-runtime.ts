/** Synthetic entitlement/download fixtures only. A PAID fixture below is NOT
 * evidence of a provider payment and is never created in a historical database. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { recordDigitalRightsReviews } from "@/lib/digital/rights-review-service";
import { studioFormatsForMasters, studioCustomerDownload } from "@/lib/digital/studio-client";
import { studioAttachment } from "@/lib/digital/studio-client-policy";
import { studioHash } from "@/lib/digital/studio-policy";
import { createDigitalDownload, digitalDownloadResponse } from "@/lib/digital/library";
import type { OrderActor } from "@/lib/orders/domain";

const raw = new URL(process.env.DATABASE_URL ?? "");
const exactSocket = ["postgres:", "postgresql:"].includes(raw.protocol) && raw.hostname === "localhost" && raw.port === "55546"
  && raw.pathname === "/lnx_studio_synthetic_20261019" && raw.username === "studio_owner" && raw.searchParams.size === 1
  && raw.searchParams.get("host") === "/private/tmp/lnx-studio-qa-20261019";
if (!exactSocket) assertSafeLocalPostgresUrl(raw.toString());
assert.equal(raw.pathname, "/lnx_studio_synthetic_20261019");
assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.LNX_STUDIO_ENABLED, "true");
assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local"); assert.notEqual(process.env.DCN_EXTERNAL_TEST_AUTHORIZED, "true");
const results: Array<{ name: string; status: "PASS" | "FAIL" }> = [];
async function check(name: string, work: () => Promise<void>) {
  try { await work(); results.push({ name, status: "PASS" }); console.log(JSON.stringify({ name, status: "PASS" })); }
  catch (error) { results.push({ name, status: "FAIL" }); console.error(JSON.stringify({ name, status: "FAIL", error: error instanceof Error ? error.message : "UNKNOWN" })); throw error; }
}
// Select a fresh delivery fixture, not a later preview-only fixture with no offer,
// and never overwrite the rights decisions of a previous successful test run.
const offerTracks = await prisma.digitalOffer.findMany({ where: { scope: "TRACK" }, select: { trackId: true } });
const job = await prisma.digitalStudioJob.findFirstOrThrow({ where: { decision: "APPROVED", status: "READY", sourceLossy: false, publishedMasterId: { not: null },
  trackId: { in: offerTracks.flatMap(row => row.trackId ? [row.trackId] : []) }, artifacts: { some: { role: "WAV_24", asset: { rightsStatus: "PENDING" } } } },
  include: { artifacts: { include: { asset: true } } }, orderBy: { createdAt: "desc" } });
const master = await prisma.digitalMaster.findUniqueOrThrow({ where: { id: job.publishedMasterId! }, include: { masterAsset: true, mp3Asset: true, previewAsset: true, track: true } });
const admin = await prisma.user.findUniqueOrThrow({ where: { id: job.actorId } });
const actor: OrderActor = { id: admin.id, email: admin.email, name: admin.displayName, status: "ACTIVE", emailVerified: true, role: "ADMIN" };
const prefix = `studio-delivery-${randomUUID()}`;
const buyer = await prisma.user.create({ data: { email: `${prefix}@example.test`, displayName: "Acheteur synthétique — aucun paiement", role: "MEMBER", status: "ACTIVE", emailVerified: true } });
const other = await prisma.user.create({ data: { email: `${prefix}-other@example.test`, role: "MEMBER", status: "ACTIVE", emailVerified: true } });
const offer = await prisma.digitalOffer.findUniqueOrThrow({ where: { trackId: job.trackId } });
const trackSnapshot = [{ trackId: job.trackId, masterId: master.id, title: job.title, position: 1, formats: ["WAV", "MP3"], wavAssetId: master.masterAssetId, mp3AssetId: master.mp3AssetId! }];
const fixturePolicy = "STUDIO_SYNTHETIC_NO_PROVIDER_CALLS";
const order = await prisma.digitalOrder.create({ data: { userId: buyer.id, mode: "TEST", status: "PAID", totalCents: 129, cartRevision: 0,
  idempotencyKey: randomUUID(), termsVersion: fixturePolicy, termsHash: studioHash({ fixturePolicy, prefix }), earlyDelivery: false, withdrawalAcknowledged: false,
  lines: { create: { offerId: offer.id, scope: "TRACK", title: `FIXTURE — ${job.title}`, priceCents: 129, offerVersion: offer.version, trackSnapshot, taxSnapshot: { fixture: true, policy: fixturePolicy } } } }, include: { lines: true } });
const line = order.lines[0], entitlement = await prisma.digitalEntitlement.create({ data: { userId: buyer.id, lineId: line.id, masterId: master.id, status: "ACTIVE" } });
await prisma.digitalEvent.create({ data: { orderId: order.id, actorId: admin.id, kind: "STUDIO_SYNTHETIC_FIXTURE_CREATED", details: { policy: fixturePolicy, providerPayment: false, historicalAcquisition: false, externalCalls: 0 } } });
const frozenBefore = studioHash({ order, line, offer });
const request = (role: string, headers?: HeadersInit) => new Request(`http://127.0.0.1/api/digital/studio/${job.id}/${role}?lineId=${line.id}&masterId=${master.id}`, { headers });
try {
  await check("Audio approval alone grants no client formats; asset CLEARED flags alone are also insufficient", async () => {
    assert.equal((await studioFormatsForMasters([master.id])).size, 0);
    await prisma.asset.updateMany({ where: { id: { in: job.artifacts.filter(item => ["MP3", "WAV_CD", "WAV_24"].includes(item.role)).map(item => item.assetId).concat(master.previewAssetId!) } }, data: { rightsStatus: "CLEARED" } });
    assert.equal((await studioFormatsForMasters([master.id])).size, 0);
  });
  await check("Explicit synthetic rights review bound to the exact version enables 3 acquired formats", async () => {
    const result = await recordDigitalRightsReviews(actor, { projectId: master.track.projectId, masterIds: [master.id], expectedReviews: [{ masterId: master.id, reviewId: null }],
      status: "APPROVED", privateEvidenceReference: `private-evidence:synthetic-studio/${job.id}`, evidenceSha256: studioHash({ synthetic: true, jobId: job.id }), attested: true,
      reason: "Synthetic test fixture only; not an approval of the owner's catalogue.", idempotencyKey: randomUUID() });
    assert.equal(result[0].status, "APPROVED");
    assert.equal((await studioFormatsForMasters([master.id])).get(master.id)?.length, 3);
  });
  await check("MP3/CD/native24 actual private downloads match frozen format checksums and exact Unicode filenames", async () => {
    for (const role of ["MP3", "WAV_CD", "WAV_24"] as const) {
      const response = await studioCustomerDownload(request(role), buyer.id, job.id, role);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("content-disposition"), studioAttachment(job.title, role));
      const bytes = new Uint8Array(await response.arrayBuffer()), artifact = job.artifacts.find(item => item.role === role)!;
      assert.equal(bytes.length, Number(artifact.asset.sizeBytes));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.asset.checksumSha256);
    }
  });
  await check("Range/HEAD work, another user and invalid role fail; no public full-file URL", async () => {
    const range = await studioCustomerDownload(request("WAV_CD", { range: "bytes=0-99" }), buyer.id, job.id, "WAV_CD");
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    const head = await studioCustomerDownload(request("WAV_24"), buyer.id, job.id, "WAV_24", true); assert.equal(head.body, null); assert.equal(head.status, 200);
    await assert.rejects(studioCustomerDownload(request("MP3"), other.id, job.id, "MP3"), { code: "NOT_FOUND" });
    await assert.rejects(studioCustomerDownload(request("ORIGINAL"), buyer.id, job.id, "ORIGINAL"), { code: "FORMAT_NOT_ACQUIRED" });
    assert.ok(job.artifacts.every(item => item.asset.visibility === "PRIVATE"));
  });
  await check("Revocation blocks supplemental formats, while old download resolver keeps its exact original asset", async () => {
    const old = await createDigitalDownload(buyer.id, line.id, master.id, "WAV");
    const response = await digitalDownloadResponse(buyer.id, old.ticketId, old.token), bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), master.masterAsset.checksumSha256);
    await prisma.digitalEntitlement.update({ where: { id: entitlement.id }, data: { status: "REVOKED" } });
    await assert.rejects(studioCustomerDownload(request("WAV_CD"), buyer.id, job.id, "WAV_CD"), { code: "NOT_FOUND" });
    await prisma.digitalEntitlement.update({ where: { id: entitlement.id }, data: { status: "ACTIVE" } });
  });
  await check("A synthetic album acquisition grants each acquired track's 3 formats, not an unproven new ZIP", async () => {
    const albumOffer = await prisma.digitalOffer.create({ data: { projectId: master.track.projectId, scope: "ALBUM", priceCents: 990, active: false, rightsConfirmed: false } });
    const albumOrder = await prisma.digitalOrder.create({ data: { userId: buyer.id, mode: "TEST", status: "PAID", totalCents: 990, cartRevision: 0, idempotencyKey: randomUUID(),
      termsVersion: fixturePolicy, termsHash: studioHash({ fixturePolicy, prefix, scope: "ALBUM" }), lines: { create: { offerId: albumOffer.id, scope: "ALBUM", title: "SYNTHETIC ALBUM — NO PROVIDER", priceCents: 990, offerVersion: 1, trackSnapshot, taxSnapshot: { fixture: true } } } }, include: { lines: true } });
    const albumLine = albumOrder.lines[0]; await prisma.digitalEntitlement.create({ data: { userId: buyer.id, lineId: albumLine.id, masterId: master.id } });
    for (const role of ["MP3", "WAV_CD", "WAV_24"]) {
      const albumRequest = new Request(`http://127.0.0.1/api/digital/studio/${job.id}/${role}?lineId=${albumLine.id}&masterId=${master.id}`);
      const response = await studioCustomerDownload(albumRequest, buyer.id, job.id, role, true); assert.equal(response.status, 200);
    }
    assert.equal(await prisma.digitalArchive.count({ where: { lineId: albumLine.id } }), 0);
  });
  await check("Frozen synthetic contracts, line prices, original offers and provider tables are unchanged", async () => {
    const currentOrder = await prisma.digitalOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    const currentLine = currentOrder.lines[0], currentOffer = await prisma.digitalOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(studioHash({ order: currentOrder, line: currentLine, offer: currentOffer }), frozenBefore);
    assert.equal(await prisma.digitalPaymentAttempt.count({ where: { orderId: order.id } }), 0);
    assert.equal(await prisma.digitalDocument.count({ where: { orderId: order.id } }), 0);
    assert.equal(await prisma.digitalInbox.count({ where: { orderId: order.id } }), 0);
    assert.equal(await prisma.digitalRefund.count({ where: { orderId: order.id } }), 0);
  });
  console.log(JSON.stringify({ status: "PASS", results, fixturePolicy, providerPayments: 0, externalCalls: 0, syntheticOnly: true }));
} finally { await prisma.$disconnect(); }

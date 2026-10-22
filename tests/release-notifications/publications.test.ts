import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@/generated/prisma/client";
import { enqueueReleasePublication, releasePublicationSource } from "@/lib/release-notifications/publications";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";

test("only a genuinely published, visible source queues once; drafts/private and external stores never queue", async () => {
  let publicVisible = false, status = "PUBLISHED", type = "ALBUM";
  const publications = new Map<string, unknown>();
  let writes = 0;
  const tx = { project: { findUnique: async () => ({ title: "Mon album", slug: "mon-album", type, publicVisible, status }) },
    releasePublication: { createMany: async ({ data, skipDuplicates }: { data: Array<{ kind: string; resourceId: string }>; skipDuplicates: boolean }) => {
      assert.equal(skipDuplicates, true); writes++;
      for (const entry of data) { const key = `${entry.kind}:${entry.resourceId}`; if (!publications.has(key)) publications.set(key, entry); }
    } } } as unknown as Prisma.TransactionClient;
  await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" }); assert.equal(writes, 0);
  publicVisible = true; status = "DRAFT";
  await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" }); assert.equal(writes, 0);
  status = "PUBLISHED"; type = "PROJECT";
  await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" }); assert.equal(writes, 0);
  type = "ALBUM";
  await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" });
  await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" });
  status = "DRAFT"; await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" });
  status = "PUBLISHED"; await enqueueReleasePublication(tx, { kind: "MUSIC", resourceId: "album-id" });
  assert.equal(publications.size, 1);
});

function readyMaster() {
  const asset = (visibility: string, mimeType: string, durationMs: number) => ({ visibility, mimeType, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 10000n });
  return { status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320, previewDurationMs: 59000,
    masterAsset: asset("PRIVATE", "audio/wav", 90000), mp3Asset: asset("PRIVATE", "audio/mpeg", 90000), previewAsset: asset("PUBLIC", "audio/mpeg", 59000) };
}
test("V13 metadata guard excludes raw PUBLISHED but effectively private music with no global catalogue scan", async () => {
  const previous = process.env.DCN_DISCOGRAPHY_V13_ENABLED; process.env.DCN_DISCOGRAPHY_V13_ENABLED = "true";
  try {
    const id = "11111111-1111-4111-8111-111111111111";
    const basic = { id, title: "LNX Beats — titre conservé", slug: "titre-conserve", type: "SINGLE", status: "PUBLISHED", publicVisible: true, membersPreviewEnabled: false };
    const valid = { ...basic, digitalOffers: [], assets: [{ asset: { rightsStatus: "CLEARED" } }], tracks: [{ status: "RELEASED", digitalMasters: [readyMaster()] }] };
    for (const patch of [
      { assets: [] }, { assets: [valid.assets[0], valid.assets[0]] }, { assets: [{ asset: { rightsStatus: "PENDING" } }] },
      { tracks: [] }, { tracks: [{ status: "DRAFT", digitalMasters: [readyMaster()] }] },
      { tracks: [{ status: "RELEASED", digitalMasters: [] }] }, { tracks: [{ status: "RELEASED", digitalMasters: [{ ...readyMaster(), status: "QUARANTINED" }] }] },
    ]) {
      const calls: string[] = [];
      const tx = { project: { findUnique: async ({ where, select }: { where: { id: string }; select: { tracks?: unknown } }) => {
        calls.push(where.id); return select.tracks ? { ...valid, ...patch } : basic;
      } } } as unknown as Prisma.TransactionClient;
      assert.equal(await releasePublicationSource(tx, "MUSIC", id), null);
      assert.deepEqual(calls, [id, id]);
    }
    const eligible = { project: { findUnique: async ({ select }: { select: { tracks?: unknown } }) => select.tracks ? valid : basic } } as unknown as Prisma.TransactionClient;
    assert.deepEqual(await releasePublicationSource(eligible, "MUSIC", id), { title: basic.title, path: "/album/titre-conserve" });
    const alreadyLive = { project: { findUnique: async ({ select }: { select: { tracks?: unknown } }) => select.tracks ? { ...valid, assets: [], tracks: [], digitalOffers: [{ id: "preserved-offer" }] } : basic } } as unknown as Prisma.TransactionClient;
    assert.deepEqual(await releasePublicationSource(alreadyLive, "MUSIC", id), { title: basic.title, path: "/album/titre-conserve" });
  } finally { if (previous === undefined) delete process.env.DCN_DISCOGRAPHY_V13_ENABLED; else process.env.DCN_DISCOGRAPHY_V13_ENABLED = previous; }
});
test("V13 member premiere keeps its exact special publication helper and cannot fall back to normal public metadata", async () => {
  const previous = process.env.DCN_DISCOGRAPHY_V13_ENABLED; process.env.DCN_DISCOGRAPHY_V13_ENABLED = "true";
  try {
    let calls = 0;
    const tx = { project: { findUnique: async () => ++calls === 1 ? { title: "Avant-première", slug: "avant-premiere", status: "PUBLISHED", publicVisible: true, type: "SINGLE", membersPreviewEnabled: true } : null } } as unknown as Prisma.TransactionClient;
    assert.equal(await releasePublicationSource(tx, "MUSIC", "11111111-1111-4111-8111-111111111111"), null);
    assert.equal(calls, 2);
  } finally { if (previous === undefined) delete process.env.DCN_DISCOGRAPHY_V13_ENABLED; else process.env.DCN_DISCOGRAPHY_V13_ENABLED = previous; }
});

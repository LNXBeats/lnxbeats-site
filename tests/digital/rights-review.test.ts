import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, assessDigitalRightsReview, digitalRightsMasterBinding,
  digitalRightsReviewHash, type DigitalRightsMaster, type DigitalRightsReviewEvent } from "@/lib/digital/rights-review-policy";
import { assertDigitalRightsReviews, digitalRightsReviewInput, loadDigitalRightsReviews, loadProjectDigitalRightsHistory, recordDigitalRightsReviews } from "@/lib/digital/rights-review-service";
import { selections } from "@/lib/digital/catalog";

/** Metadata/repository doubles only. No audio, legal document, DB or provider claim. */
function fixture() {
  const id = randomUUID(), trackId = randomUUID(), projectId = randomUUID(), wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
  const asset = (assetId: string, mimeType: string, visibility = "PRIVATE", durationMs = 120_000) => ({ id: assetId, mimeType, visibility, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 400_000n });
  const master: DigitalRightsMaster = { id, trackId, version: 1, masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    mp3BitrateKbps: 320, previewDurationMs: 59_900, masterAsset: asset(wavId, "audio/wav"), mp3Asset: asset(mp3Id, "audio/mpeg"), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_900) };
  const actor: OrderActor = { id: randomUUID(), email: "synthetic@example.invalid", name: "Synthetic Admin", role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const user = { id: actor.id, role: "ADMIN", status: "ACTIVE", emailVerified: true }, events: Array<DigitalRightsReviewEvent & { externalKey: string }> = [], locks:string[]=[];
  let currentMasterId: string = master.id, creates = 0;
  const db = {
    $queryRaw: async (...args:unknown[]) => {locks.push(...args.slice(1).filter((value):value is string=>typeof value==="string"));return[];},
    user: { async findUnique() { return user; } },
    digitalMaster: { async findMany({ where }: { where: { id: { in: string[] } } }) { return where.id.in.includes(master.id) ? [master] : []; },
      async findFirst() { return { id: currentMasterId }; } },
    digitalEvent: {
      async findFirst({ where }: { where: { kind: string; details: { path: string[]; equals: string } } }) {
        assert.equal(where.kind, DIGITAL_RIGHTS_REVIEW_EVENT); assert.deepEqual(where.details.path, ["binding", "masterId"]);
        return events.filter(event => (event.details as { binding: { masterId: string } }).binding.masterId === where.details.equals)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] ?? null;
      },
      async findUnique({ where }: { where: { externalKey: string } }) { return events.find(event => event.externalKey === where.externalKey) ?? null; },
      async create({ data }: { data: Omit<(typeof events)[number], "id"> }) { const row = { ...data, id: randomUUID() }; events.push(row); creates++; return row; },
    },
  } as unknown as Prisma.TransactionClient;
  const input = () => ({ projectId, masterIds: [master.id], expectedReviews: [{ masterId: master.id, reviewId: events.at(-1)?.id ?? null }], status: "APPROVED",
    privateEvidenceReference: "private-evidence:synthetic/album-manifest-01", evidenceSha256: "b".repeat(64), attested: true, reason: null as string | null, idempotencyKey: randomUUID() });
  return { master, actor, user, db, events, input, locks, current: (id: string) => { currentMasterId = id; }, creates: () => creates };
}
async function isolated<T>(db: Prisma.TransactionClient, run: () => Promise<T>) {
  const previous = { DCN_ENABLED: process.env.DCN_ENABLED, DCN_MODE: process.env.DCN_MODE, RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
    MEDIA_DEPLOYMENT_ENV: process.env.MEDIA_DEPLOYMENT_ENV, PAYMENT_DEPLOYMENT_ENV: process.env.PAYMENT_DEPLOYMENT_ENV }, transaction = prisma.$transaction;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" }); delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(db)) as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("rights review: no approval from offer flag or missing journal; approved evidence binds exact master/audio hashes", async () => {
  const f = fixture();
  await assert.rejects(() => assertDigitalRightsReviews(f.db, [f.master.id]), { code: "RIGHTS_REVIEW_REQUIRED" });
  await isolated(f.db, () => recordDigitalRightsReviews(f.actor, f.input()));
  assert.ok(f.locks.includes(`digital-rights-master:${f.master.id}`));assert.ok(f.locks.includes(`digital-track:${f.master.trackId}`));
  await assertDigitalRightsReviews(f.db, [f.master.id]);
  const summary = (await loadDigitalRightsReviews(f.db, [f.master]))[0];
  assert.equal(summary.status, "APPROVED"); assert.deepEqual(Object.keys(summary).sort(), ["masterId", "reviewId", "reviewedAt", "status"]);
  assert.equal(JSON.stringify(summary).includes("private-evidence"), false); assert.equal(JSON.stringify(summary).includes("b".repeat(64)), false);
  for (const change of [{ ...f.master, version: 2 }, { ...f.master, masterAsset: { ...f.master.masterAsset, checksumSha256: "d".repeat(64) } },
    { ...f.master, mp3Asset: { ...f.master.mp3Asset!, checksumSha256: "e".repeat(64) } }, { ...f.master, previewAsset: { ...f.master.previewAsset!, checksumSha256: "f".repeat(64) } }]) {
    assert.equal(assessDigitalRightsReview(change, f.events[0], f.user).status, "REVIEW_REQUIRED");
  }
});

test("rights review: latest non-approved state never falls back, including a same-tick revocation", async () => {
  const f = fixture(), now = Date.now; Date.now = () => 1_792_056_000_000;
  try {
    await isolated(f.db, async () => {
      await recordDigitalRightsReviews(f.actor, f.input());
      const original = f.events[0];
      await recordDigitalRightsReviews(f.actor, { ...f.input(), status: "REVOKED", attested: false, privateEvidenceReference: null, evidenceSha256: null, reason: "Synthetic collaborator permission withdrawn" });
      assert.equal(f.events.length, 2); assert.equal(f.events[1].createdAt.getTime(), original.createdAt.getTime() + 1);
      assert.equal((await loadDigitalRightsReviews(f.db, [f.master]))[0].status, "REVOKED");
      await assert.rejects(() => assertDigitalRightsReviews(f.db, [f.master.id]), { code: "RIGHTS_REVIEW_REQUIRED" });
      for (const status of ["DRAFT", "REVIEW_REQUIRED", "REJECTED"] as const) {
        await recordDigitalRightsReviews(f.actor, { ...f.input(), status, reason: status === "REJECTED" ? "Synthetic refusal" : null });
        assert.equal((await loadDigitalRightsReviews(f.db, [f.master]))[0].status, status);
      }
      assert.equal((f.events[0].details as { status: string }).status, "APPROVED");
    });
  } finally { Date.now = now; }
});

test("rights review: fresh DB Admin role, active status and verified email are required for approval and later use", async () => {
  for (const change of [{ role: "MEMBER" }, { status: "SUSPENDED" }, { emailVerified: false }]) {
    const f = fixture(); await isolated(f.db, () => recordDigitalRightsReviews(f.actor, f.input())); Object.assign(f.user, change);
    await assert.rejects(() => assertDigitalRightsReviews(f.db, [f.master.id]), { code: "RIGHTS_REVIEW_REQUIRED" });
    await assert.rejects(() => isolated(f.db, () => recordDigitalRightsReviews(f.actor, f.input())), { code: "ADMIN_REQUIRED" });
    assert.equal(f.creates(), 1);
  }
});

test("rights review: approvals require opaque private reference, full hash and attestation; input cannot mint actor or binding", () => {
  const f = fixture(), input = f.input();
  for (const patch of [{ privateEvidenceReference: null }, { evidenceSha256: null }, { evidenceSha256: "b".repeat(63) }, { attested: false },
    { privateEvidenceReference: "https://example.invalid/?token=never" }, { privateEvidenceReference: "private-evidence:../secret" },
    { actorId: randomUUID() }, { binding: digitalRightsMasterBinding(f.master) }, { status: "APPROVED_BY_BROWSER" }, { status: "REVOKED", reason: null }]) {
    assert.throws(() => digitalRightsReviewInput({ ...input, ...patch }));
  }
});

test("rights review: retries append once; changed payload or stale decision cannot override latest state", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    const input = f.input(); await recordDigitalRightsReviews(f.actor, input); await recordDigitalRightsReviews(f.actor, input); assert.equal(f.creates(), 1);
    await assert.rejects(() => recordDigitalRightsReviews(f.actor, { ...input, reason: "Different content" }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(() => recordDigitalRightsReviews(f.actor, { ...f.input(), expectedReviews: input.expectedReviews }), { code: "RIGHTS_REVIEW_CHANGED" });
    assert.equal(f.creates(), 1);
  });
});

test("rights review: twelve current masters can share one private manifest with distinct immutable bindings", async () => {
  const f = fixture(), masters = [f.master, ...Array.from({length:11},()=>fixture().master)];
  f.db.digitalMaster.findMany=(async()=>masters) as unknown as typeof f.db.digitalMaster.findMany;
  f.db.digitalMaster.findFirst=(async({where}:{where:{trackId:string}})=>({id:masters.find(master=>master.trackId===where.trackId)!.id})) as unknown as typeof f.db.digitalMaster.findFirst;
  const input={...f.input(),masterIds:masters.map(master=>master.id),expectedReviews:masters.map(master=>({masterId:master.id,reviewId:null}))};
  await isolated(f.db,()=>recordDigitalRightsReviews(f.actor,input));
  assert.equal(f.creates(),12);assert.equal(new Set(f.events.map(event=>(event.details as {binding:{masterId:string}}).binding.masterId)).size,12);
  assert.equal(new Set(f.events.map(event=>(event.details as {evidenceSha256:string}).evidenceSha256)).size,1);
  await assertDigitalRightsReviews(f.db,masters.map(master=>master.id));
});

test("rights review: Admin history is bounded and exposes only date, version, status and opaque reviewer/review IDs",async()=>{
  const f=fixture();await isolated(f.db,()=>recordDigitalRightsReviews(f.actor,f.input()));
  const db={track:{async findMany(){return[{id:f.master.trackId}];}},digitalEvent:{async findMany(args:{take:number;where:{kind:string}}){
    assert.equal(args.take,51);assert.equal(args.where.kind,DIGITAL_RIGHTS_REVIEW_EVENT);return Array.from({length:51},()=>({...f.events[0],id:randomUUID()}));
  }}} as unknown as Prisma.TransactionClient;
  const history=await loadProjectDigitalRightsHistory(db,f.input().projectId);
  assert.equal(history.entries.length,50);assert.equal(history.truncated,true);
  assert.deepEqual(Object.keys(history.entries[0]).sort(),["createdAt","masterVersion","reviewId","reviewerId","status"]);
  assert.equal(JSON.stringify(history).includes("private-evidence"),false);assert.equal(JSON.stringify(history).includes("b".repeat(64)),false);
});

test("rights review: old strict edition may be revoked after replacement; only approval requires current master", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    await recordDigitalRightsReviews(f.actor, f.input()); f.current(randomUUID());
    await assertDigitalRightsReviews(f.db, [f.master.id]); // Earlier pinned checkout still has its own exact approval.
    await assert.rejects(() => recordDigitalRightsReviews(f.actor, f.input()), { code: "RIGHTS_MASTER_CHANGED" });
    await recordDigitalRightsReviews(f.actor, { ...f.input(), status: "REVOKED", reason: "Synthetic review incident" });
    await assert.rejects(() => assertDigitalRightsReviews(f.db, [f.master.id]), { code: "RIGHTS_REVIEW_REQUIRED" });
    assert.equal(f.creates(), 2);
  });
});

test("rights review: legacy encoder, changed record hash and unrelated signature do not approve new sales", async () => {
  const f = fixture(); await isolated(f.db, () => recordDigitalRightsReviews(f.actor, f.input()));
  const original = f.events[0], details = structuredClone(original.details) as Record<string, unknown>;
  assert.equal(assessDigitalRightsReview({ ...f.master, encoderVersion: "ffmpeg-libmp3lame-cbr-v1" }, original, f.user).status, "REVIEW_REQUIRED");
  details.status = "APPROVED"; details.attestation = "I did not verify collaborator rights";
  assert.equal(assessDigitalRightsReview(f.master, { ...original, details }, f.user).status, "REVIEW_REQUIRED");
  const { recordHash: _recordHash, ...changedProof } = details; void _recordHash;
  assert.equal(assessDigitalRightsReview(f.master, { ...original, details: { ...changedProof, recordHash: digitalRightsReviewHash({ actorId: f.actor.id, ...changedProof }) } }, f.user).status, "REVIEW_REQUIRED");
  assert.equal(DIGITAL_RIGHTS_ATTESTATION.includes("collaborateurs"), true); assert.ok(DIGITAL_RIGHTS_REVIEW_POLICY);
});

test("rights review: empty catalogue selection keeps empty cart valid, but direct first-delivery review cannot be empty", async () => {
  const f = fixture(), db = { digitalOffer: { async findMany() { return []; } } } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await selections([], db), []);
  await assert.rejects(() => assertDigitalRightsReviews(f.db, []), { code: "INVALID_RIGHTS_REVIEW" });
});

test("rights review: Admin endpoint is private/same-origin; raw evidence never enters public catalogue or historical download flow", async () => {
  const route = await readFile(new URL("../../app/api/admin/digital/rights-reviews/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/digitalActor\(request, true\)/g) ?? []).length, 2); assert.match(route, /digitalBody/); assert.match(route, /digitalRateLimit/); assert.match(route, /digitalJson/);
  const ui = await readFile(new URL("../../components/digital-rights-review.tsx", import.meta.url), "utf8"); assert.match(ui, /cache: "no-store"/); assert.match(ui, /credentials: "same-origin"/);
  const library = await readFile(new URL("../../lib/digital/library.ts", import.meta.url), "utf8"); assert.doesNotMatch(library, /rights-review/);
});

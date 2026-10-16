import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_EXCERPT_EVENT, digitalExcerptCandidateReady, digitalExcerptDetails,
  digitalExcerptHash, digitalExistingExcerptReady, type DigitalExcerptDetails, type DigitalExcerptEvent, type DigitalExcerptMaster } from "@/lib/digital/excerpt-policy";
import { getDigitalExcerptSelection, recordDigitalExcerptSelection } from "@/lib/digital/excerpt-service";

/** Local metadata/repository doubles, not real file, browser, DB or provider recipes. */
function fixture() {
  const sourceId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
  const asset = (id: string, mimeType: string, visibility = "PRIVATE", durationMs = 125_960) => ({ id, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW",
    mimeType, visibility, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 400_000n });
  const master: DigitalExcerptMaster = { id: randomUUID(), trackId: randomUUID(), version: 1, masterAssetId: sourceId, previewAssetId: previewId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    mp3BitrateKbps: 320, previewStartMs: 0, previewDurationMs: 59_950, masterAsset: asset(sourceId, "audio/wav"), mp3Asset: asset(mp3Id, "audio/mpeg"), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950) };
  const actor: OrderActor = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true, email: "synthetic@example.invalid", name: "QA synthetic reviewer" };
  const user = { id: actor.id, role: "ADMIN", status: "ACTIVE", emailVerified: true }, events: Array<DigitalExcerptEvent & { externalKey: string }> = [], assets = new Map<string, ReturnType<typeof asset>>();
  let currentMasterId = master.id;
  const locks: string[] = [], db = {
    $queryRaw: async (...args: unknown[]) => { locks.push(...args.slice(1).filter((value): value is string => typeof value === "string")); return []; },
    user: { async findUnique() { return user; } },
    digitalMaster: { async findUnique() { return master; }, async findFirst() { return { id: currentMasterId }; } },
    digitalEvent: {
      async findFirst({ where }: { where: { kind: string; details: { path: string[]; equals: string } } }) {
        assert.equal(where.kind, DIGITAL_EXCERPT_EVENT);
        return events.filter(event => {
          const details = event.details as DigitalExcerptDetails;
          return where.details.path[0] === "binding" ? details.binding.masterId === where.details.equals : details.candidateAssetId === where.details.equals;
        }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] ?? null;
      },
      async findUnique({ where }: { where: { externalKey: string } }) { return events.find(event => event.externalKey === where.externalKey) ?? null; },
      async create({ data }: { data: Omit<(typeof events)[number], "id"> }) { const event = { ...data, id: randomUUID() }; events.push(event); return event; },
    },
    asset: { async findUnique({ where }: { where: { id: string } }) { return assets.get(where.id) ?? null; } },
  } as unknown as Prisma.TransactionClient;
  const input = (action: "save" | "generate" | "validate" = "save", startMs = 1_234) => ({ action, startMs, expectedRevisionId: events.at(-1)?.id ?? null, idempotencyKey: randomUUID(), attested: action === "validate" });
  function generated() {
    const queued = events.at(-1)!; assert.equal((queued.details as DigitalExcerptDetails).status, "QUEUED");
    const candidateId = randomUUID(), candidate = asset(candidateId, "audio/mpeg", "PRIVATE", 59_950); assets.set(candidateId, candidate);
    const proof: Omit<DigitalExcerptDetails, "recordHash"> = { ...(queued.details as DigitalExcerptDetails), status: "READY", candidateAssetId: candidateId,
      candidateSha256: candidate.checksumSha256, previewDurationMs: 59_950, requestId: queued.id, previousRevisionId: queued.id, errorCode: null, attested: false };
    delete (proof as Partial<DigitalExcerptDetails>).recordHash;
    const event = { id: randomUUID(), actorId: actor.id, externalKey: `dcn-excerpt-result:${queued.id}`, kind: DIGITAL_EXCERPT_EVENT,
      details: { ...proof, recordHash: digitalExcerptHash({ actorId: actor.id, ...proof }) }, createdAt: new Date(queued.createdAt.getTime() + 1) };
    events.push(event); return candidate;
  }
  return { master, actor, user, db, events, assets, input, generated, locks, current(id: string) { currentMasterId = id; } };
}
async function isolated<T>(db: Prisma.TransactionClient, run: () => Promise<T>) {
  const names = ["DCN_ENABLED", "DCN_MODE", "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV", "DCN_RECOVERY_EXCERPTS_REVIEW_ONLY", "DCN_STORAGE_MODE"] as const;
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]])), transaction = prisma.$transaction;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" }); delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(db)) as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

// R4-only additions. All positive approvals below are ephemeral repository doubles, never R2/R3 QA rows.
const r4Project = "e62bfcea-6d0c-4a9c-8de9-eee8961c30d7";
function r4Input(f: ReturnType<typeof fixture>) { return { ...f.input("save", 0), action: "validate-existing" as const, attested: true }; }
async function recovered(f: ReturnType<typeof fixture>, run: () => Promise<void>) {
  Object.assign(f.master, { track: { projectId: r4Project } });
  return isolated(f.db, async () => { Object.assign(process.env, { DCN_RECOVERY_EXCERPTS_REVIEW_ONLY: "true", DCN_STORAGE_MODE: "LOCAL" }); await run(); });
}
test("R4: exact existing preview validates only after fresh explicit attestation, without READY/media writes", async () => {
  const f = fixture(); await recovered(f, async () => {
    assert.equal((await getDigitalExcerptSelection(f.actor, f.master.id)).selection.status, "TO_LISTEN"); assert.equal(f.events.length, 0);
    const before = structuredClone(f.master), result = await recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f));
    assert.equal(result.selection.status, "VALIDATED"); assert.equal(result.selection.candidateUrl, `/api/admin/digital/previews/${f.master.previewAssetId}`);
    assert.equal(f.events.length, 1); assert.equal(f.assets.size, 0); assert.deepEqual(f.master, before);
    const d = digitalExcerptDetails(f.events[0], f.master); assert.equal(d.candidateOrigin, "EXISTING_PROVISIONAL"); assert.equal(d.attested, true);
    assert.equal(d.startMs, 0); assert.equal(d.previewDurationMs, 59_950); assert.equal(d.candidateAssetId, f.master.previewAssetId);
    assert.equal(d.previousRevisionId, null); assert.equal(d.requestId, null); assert.equal(digitalExistingExcerptReady(f.master, d), true);
  });
});
test("R4: missing attestation, edited start and every generation/draft action are refused without event", async () => {
  const f = fixture(); await recovered(f, async () => {
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...r4Input(f), attested: false }), { code: "EXCERPT_ATTESTATION_REQUIRED" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...r4Input(f), startMs: 1 }), { code: "EXCERPT_NOT_READY" });
    for (const action of ["save", "generate", "validate"] as const) await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input(action, 0)), { code: "EXCERPT_NOT_READY" });
    assert.equal(f.events.length, 0); assert.equal(f.assets.size, 0);
  });
});
test("R4: new action is fail-closed outside recovery-only LOCAL TEST and exact project", async () => {
  for (const patch of [{ DCN_RECOVERY_EXCERPTS_REVIEW_ONLY: "false" }, { DCN_STORAGE_MODE: "R2" }, { DCN_MODE: "LIVE" }]) {
    const f = fixture(); await recovered(f, async () => { Object.assign(process.env, patch); await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f))); assert.equal(f.events.length, 0); });
  }
  const f = fixture(); await recovered(f, async () => { Object.assign(f.master, { track: { projectId: randomUUID() } }); await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)), { code: "EXCERPT_NOT_READY" }); assert.equal(f.events.length, 0); });
});
test("R4: arbitrary PUBLIC assets and changed preview bindings never inherit an approval", async () => {
  const f = fixture(); await recovered(f, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)); const event = f.events[0];
    for (const patch of [{ previewAssetId: randomUUID() }, { previewAssetId: "invalid" }, { previewStartMs: 1 }, { previewDurationMs: 60_001 },
      { previewAsset: { ...f.master.previewAsset!, id: randomUUID() } },
      { previewAsset: { ...f.master.previewAsset!, checksumSha256: "f".repeat(64) } },
      { previewAsset: { ...f.master.previewAsset!, visibility: "PRIVATE" } },
      { previewAsset: { ...f.master.previewAsset!, type: "AUDIO" } }]) assert.throws(() => digitalExcerptDetails(event, { ...f.master, ...patch }));
    const original = event.details as DigitalExcerptDetails; const corrupted = { ...original, candidateOrigin: "ARBITRARY_PUBLIC" }; const proof: Partial<typeof corrupted> = { ...corrupted }; delete proof.recordHash;
    assert.throws(() => digitalExcerptDetails({ ...event, details: { ...proof, recordHash: digitalExcerptHash({ actorId: event.actorId, ...proof }) } }, f.master));
    assert.equal(digitalExcerptCandidateReady({ ...f.master.previewAsset!, type: "AUDIO_PREVIEW" } as Parameters<typeof digitalExcerptCandidateReady>[0], original), false);
  });
});
test("R4: repeated request is idempotent; stale/concurrent/different requests cannot append a second approval", async () => {
  const f = fixture(); await recovered(f, async () => {
    const input = r4Input(f), first = await recordDigitalExcerptSelection(f.actor, f.master.id, input);
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor, f.master.id, input), first); assert.equal(f.events.length, 1);
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...input, startMs: 1 }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...input, idempotencyKey: randomUUID() }), { code: "EXCERPT_SELECTION_CHANGED" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)), { code: "EXCERPT_NOT_READY" }); assert.equal(f.events.length, 1);
  });
});
test("R4: current admin identity and current master are rechecked before any approval", async () => {
  for (const patch of [{ role: "MEMBER" }, { status: "SUSPENDED" }, { emailVerified: false }]) {
    const f = fixture(); await recovered(f, async () => { Object.assign(f.user, patch); await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)), { code: "ADMIN_REQUIRED" }); assert.equal(f.events.length, 0); });
  }
  const f = fixture(); await recovered(f, async () => { f.current(randomUUID()); await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)), { code: "EXCERPT_MASTER_CHANGED" }); assert.equal(f.events.length, 0); });
});
test("R4: JSONB key ordering is stable and signed provenance tampering is rejected", async () => {
  const f = fixture(); await recovered(f, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, r4Input(f)); const e = f.events[0], d = e.details as DigitalExcerptDetails;
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
    assert.equal(digitalExcerptDetails({ ...e, details: reorder(d) }, f.master).status, "VALIDATED");
    for (const patch of [{ candidateOrigin: undefined }, { candidateSha256: "f".repeat(64) }, { attested: false }]) assert.throws(() => digitalExcerptDetails({ ...e, details: { ...d, ...patch } }, f.master));
  });
});

async function liveReview(f: ReturnType<typeof fixture>, run: () => Promise<void>) {
  return isolated(f.db,async()=>{
    const saved={...process.env};
    try{
      Object.assign(process.env,{NODE_ENV:"production",DCN_MODE:"LIVE",RAILWAY_ENVIRONMENT_NAME:"production",RAILWAY_ENVIRONMENT:"production",MEDIA_DEPLOYMENT_ENV:"production",PAYMENT_DEPLOYMENT_ENV:"production",DCN_STORAGE_MODE:"OBJECT",PAYMENT_PRODUCTION_CONFIRM:"payments-production-live-approved"});
      for(const key of ["DCN_RECOVERY_EXCERPTS_REVIEW_ONLY","DCN_EXTERNAL_TEST_AUTHORIZED","DCN_LOCAL_REVIEW_AUTHORIZED"])delete process.env[key];
      for(const asset of [f.master.masterAsset,f.master.mp3Asset,f.master.previewAsset])Object.assign(asset!,{storageBackend:"OBJECT",storageProvider:"r2",storageKey:`digital/synthetic/${randomUUID()}.mp3`});
      await run();
    }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
  });
}
test("LIVE current excerpt: exact imported preview gets one attested approval without changing masters, rights or media",async()=>{
  const f=fixture();await liveReview(f,async()=>{
    const before=structuredClone(f.master),input={...r4Input(f),action:"validate-current"};
    const first=await recordDigitalExcerptSelection(f.actor,f.master.id,input);
    assert.equal(first.selection.status,"VALIDATED");assert.equal(f.events.length,1);assert.deepEqual(f.master,before);assert.equal(f.assets.size,0);
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor,f.master.id,input),first);assert.equal(f.events.length,1);
    for(const action of ["save","generate","validate","validate-existing"])await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...input,action}));
  });
});
test("LIVE current excerpt: absent attestation, changed offset, local storage and stale master fail closed",async()=>{
  const f=fixture();await liveReview(f,async()=>{
    const input={...r4Input(f),action:"validate-current"};
    await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...input,attested:false}),{code:"EXCERPT_ATTESTATION_REQUIRED"});
    await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...input,startMs:1}),{code:"EXCERPT_NOT_READY"});
    Object.assign(f.master.masterAsset,{storageBackend:"LOCAL"});await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,input),{code:"LIVE_MEDIA_STORAGE_NOT_READY"});
    Object.assign(f.master.masterAsset,{storageBackend:"OBJECT"});f.current(randomUUID());await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,input),{code:"EXCERPT_MASTER_CHANGED"});
    assert.equal(f.events.length,0);
  });
});
test("current excerpt cannot reuse the LIVE action in Recovery TEST or bypass fresh Admin validation",async()=>{
  const f=fixture();await isolated(f.db,async()=>{await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...r4Input(f),action:"validate-current"}));});
  await liveReview(f,async()=>{f.user.role="MEMBER";await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...r4Input(f),action:"validate-current"}),{code:"ADMIN_REQUIRED"});assert.equal(f.events.length,0);});
});

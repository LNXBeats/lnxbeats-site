import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_EXCERPT_EVENT, DIGITAL_EXCERPT_POLICY, assertDigitalExcerptRevision, digitalExcerptBinding, digitalExcerptCandidateReady, digitalExcerptDetails,
  digitalExcerptHash, digitalExcerptInput, digitalExcerptSelection, type DigitalExcerptDetails, type DigitalExcerptEvent, type DigitalExcerptMaster } from "@/lib/digital/excerpt-policy";
import { getDigitalExcerptCandidate, getDigitalExcerptSelection, recordDigitalExcerptSelection } from "@/lib/digital/excerpt-service";

/** Local metadata/repository doubles, not real file, browser, DB or provider recipes. */
function fixture() {
  const sourceId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
  const asset = (id: string, mimeType: string, visibility = "PRIVATE", durationMs = 125_960) => ({ id, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW",
    mimeType, visibility, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 400_000n });
  const master: DigitalExcerptMaster = { id: randomUUID(), trackId: randomUUID(), version: 1, masterAssetId: sourceId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
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
  const input = (action: "save" | "generate" | "validate" = "save", startMs = 0) => ({ action, startMs, expectedRevisionId: events.at(-1)?.id ?? null, idempotencyKey: randomUUID(), attested: action === "validate" });
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
  const names = ["DCN_ENABLED", "DCN_MODE", "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"] as const;
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]])), transaction = prisma.$transaction;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" }); delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(db)) as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("excerpt: immutable strict source binding, never rights approval or guessed WAV metadata", () => {
  const f = fixture(), binding = digitalExcerptBinding(f.master);
  assert.deepEqual(Object.keys(binding).sort(), ["durationMs", "masterId", "sourceAssetId", "sourceSha256", "trackId", "version"]);
  for (const patch of [{ status: "QUARANTINED" }, { version: 0 }, { codec: "mp3" }, { encoderVersion: "legacy" },
    { masterAsset: { ...f.master.masterAsset, visibility: "PUBLIC" } }, { masterAsset: { ...f.master.masterAsset, checksumSha256: null } },
    { previewDurationMs: 60_001 }, { mp3Asset: null }]) assert.throws(() => digitalExcerptBinding({ ...f.master, ...patch }));
  assert.equal(JSON.stringify(binding).includes("rightsStatus"), false);
});

test("excerpt: no event preserves original provisional preview and displays À écouter", () => {
  const f = fixture(); assert.deepEqual(digitalExcerptSelection(f.master, null), { revisionId: null, status: "TO_LISTEN", startMs: 0, previewDurationMs: 59_950, candidateUrl: null, errorCode: null });
});

test("excerpt: input rejects browser actor/binding/status and requires explicit validation attestation", () => {
  const f = fixture(), input = f.input();
  for (const patch of [{ action: "publish" }, { action: "validate", attested: false }, { actorId: randomUUID() }, { status: "VALIDATED" }, { binding: digitalExcerptBinding(f.master) },
    { startMs: -1 }, { startMs: 0.5 }, { startMs: "1.234" }, { expectedRevisionId: "invalid" }, { idempotencyKey: "same" }, { attested: undefined }])
    assert.throws(() => digitalExcerptInput({ ...input, ...patch }));
  assert.deepEqual(digitalExcerptInput(input), input);
});

test("excerpt: draft save then reload is persistent, narrowly projected, precise and append-only", async () => {
  const f = fixture(), before = structuredClone(f.master);
  await isolated(f.db, async () => {
    const saved = await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("save", 0));
    assert.equal(saved.selection.status, "DRAFT"); assert.equal(saved.selection.startMs, 0); assert.equal(saved.selection.candidateUrl, null);
    assert.deepEqual((await getDigitalExcerptSelection(f.actor, f.master.id)).selection, saved.selection);
    assert.equal(JSON.stringify(saved).includes("sourceSha256"), false); assert.equal(JSON.stringify(saved).includes("storageKey"), false);
    assert.ok(f.locks.includes(`digital-track:${f.master.trackId}`)); assert.ok(f.locks.includes(`digital-excerpt:${f.master.id}`));
  });
  assert.deepEqual(f.master, before); assert.equal(f.events.length, 1);
});

test("excerpt: all new draft and generation requests start at zero, never a client-selected offset", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    for (const start of [1, 1_234, 125_959, 125_960, 125_961, 1_800_000]) for (const action of ["save","generate"] as const) await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input(action, start)), { code: "INVALID_EXCERPT" });
    assert.equal(f.events.length, 0);
    await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("save", 0)); assert.equal(f.events.length, 1);
  });
});

test("excerpt: CAS refuses stale decisions, duplicates append once, changed idempotent body fails", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    const input = f.input(); const original = await recordDigitalExcerptSelection(f.actor, f.master.id, input);
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor, f.master.id, input), original); assert.equal(f.events.length, 1);
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...input, startMs: 2_345 }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...f.input(), expectedRevisionId: null }), { code: "EXCERPT_SELECTION_CHANGED" });
    assert.throws(() => assertDigitalExcerptRevision(original.selection, randomUUID()), { code: "EXCERPT_SELECTION_CHANGED" });
  });
});

test("excerpt: generation queues only, no new master, asset or original preview writes in web request", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    const result = await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("generate", 0));
    assert.equal(result.selection.status, "QUEUED"); assert.equal(result.selection.candidateUrl, null); assert.equal(f.assets.size, 0);
    assert.equal(f.events.length, 1); assert.equal(f.master.previewStartMs, 0);
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input("validate", 0)), { code: "EXCERPT_NOT_READY" });
  });
});

test("excerpt: READY candidate keeps separate artistic validation; a new draft preserves prior approvals", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("generate", 0)); const candidate = f.generated();
    const ready = await getDigitalExcerptSelection(f.actor, f.master.id); assert.equal(ready.selection.status, "READY");
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, { ...f.input("validate", 0), attested: false }), { code: "EXCERPT_ATTESTATION_REQUIRED" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input("validate", 1)), { code: "EXCERPT_NOT_READY" });
    const input = f.input("validate", 0), validated = await recordDigitalExcerptSelection(f.actor, f.master.id, input);
    assert.equal(validated.selection.status, "VALIDATED"); assert.deepEqual(await recordDigitalExcerptSelection(f.actor, f.master.id, input), validated);
    const saved = await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("save", 0));
    assert.equal(saved.selection.status, "DRAFT"); assert.equal(saved.selection.candidateUrl, null); assert.ok(f.assets.has(candidate.id));
    assert.equal((f.events[2].details as DigitalExcerptDetails).status, "VALIDATED");
    assert.equal(f.master.previewStartMs, 0); assert.equal(f.master.previewDurationMs, 59_950);
  });
});

test("excerpt: freshly suspended, unverified or non-Admin cannot read, modify, validate or serve candidates", async () => {
  for (const patch of [{ role: "MEMBER" }, { status: "SUSPENDED" }, { emailVerified: false }]) {
    const f = fixture(); await isolated(f.db, async () => {
      await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("generate")); const asset = f.generated(); Object.assign(f.user, patch);
      await assert.rejects(() => getDigitalExcerptSelection(f.actor, f.master.id), { code: "ADMIN_REQUIRED" });
      await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input()), { code: "ADMIN_REQUIRED" });
      await assert.rejects(() => getDigitalExcerptCandidate(f.actor, asset.id), { code: "ADMIN_REQUIRED" });
    });
  }
});

test("excerpt: replacement master refuses current selection mutation and does not transfer approval", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, f.input()); f.current(randomUUID());
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input()), { code: "EXCERPT_MASTER_CHANGED" });
    await assert.rejects(() => getDigitalExcerptSelection(f.actor, f.master.id), { code: "EXCERPT_MASTER_CHANGED" });
  });
});

test("excerpt: canonical integrity survives JSONB key ordering but rejects changed source, record or invalid file", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("generate")); const candidate = f.generated(), event = f.events.at(-1)!;
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
    assert.equal(digitalExcerptDetails({ ...event, details: reorder(event.details) }, f.master).status, "READY");
    assert.throws(() => digitalExcerptDetails({ ...event, details: { ...(event.details as DigitalExcerptDetails), startMs: 55_000 } }, f.master));
    assert.throws(() => digitalExcerptDetails(event, { ...f.master, masterAsset: { ...f.master.masterAsset, checksumSha256: "d".repeat(64) } }));
    const details = event.details as DigitalExcerptDetails; assert.equal(digitalExcerptCandidateReady(candidate, details), true);
    for (const patch of [{ visibility: "PUBLIC" }, { type: "AUDIO" }, { checksumSha256: "c".repeat(64) }, { durationMs: 60_001 }, { sizeBytes: 4_000_000n }])
      assert.equal(digitalExcerptCandidateReady({ ...candidate, ...patch }, details), false);
    assert.equal((await getDigitalExcerptCandidate(f.actor, candidate.id)).id, candidate.id);
    await assert.rejects(() => getDigitalExcerptCandidate(f.actor, randomUUID()), { code: "NOT_FOUND" });
  });
});

test("excerpt: same-tick edits advance monotonically, never UUID-dependent", async () => {
  const f = fixture(), now = Date.now; Date.now = () => 1_792_056_000_000;
  try { await isolated(f.db, async () => {
    await recordDigitalExcerptSelection(f.actor, f.master.id, f.input()); await recordDigitalExcerptSelection(f.actor, f.master.id, f.input("save", 0));
    assert.equal(f.events[1].createdAt.getTime(), f.events[0].createdAt.getTime() + 1); assert.equal((await getDigitalExcerptSelection(f.actor, f.master.id)).selection.startMs, 0);
  }); } finally { Date.now = now; }
});

test("excerpt: historical nonzero candidate remains readable and can retain its exact approval",async()=>{
  const f=fixture();await isolated(f.db,async()=>{
    await recordDigitalExcerptSelection(f.actor,f.master.id,f.input("generate",0));f.generated();
    // Ephemeral repository double representing an already prepared historical
    // candidate; no real metadata, file or database is changed by this test.
    const event=f.events.at(-1)!,proof={...(event.details as DigitalExcerptDetails),startMs:1234};
    delete (proof as Partial<DigitalExcerptDetails>).recordHash;
    event.details={...proof,recordHash:digitalExcerptHash({actorId:f.actor.id,...proof})};
    assert.equal((await getDigitalExcerptSelection(f.actor,f.master.id)).selection.startMs,1234);
    const input=f.input("validate",1234),validated=await recordDigitalExcerptSelection(f.actor,f.master.id,input);
    assert.equal(validated.selection.startMs,1234);assert.equal(validated.selection.status,"VALIDATED");
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor,f.master.id,input),validated);
    assert.equal(f.master.previewStartMs,0);
  });
});

test("excerpt: TEST fail-closed remains independent from prices, rights or validated selection", async () => {
  const f = fixture(); await isolated(f.db, async () => {
    process.env.DCN_MODE = "LIVE";
    await assert.rejects(() => getDigitalExcerptSelection(f.actor, f.master.id), { code: "DIGITAL_CLOSED" });
    await assert.rejects(() => recordDigitalExcerptSelection(f.actor, f.master.id, f.input()), { code: "DIGITAL_CLOSED" });
    assert.equal(f.events.length, 0);
  });
});

test("excerpt: worker and routes preserve security/static scope and never process business or historical queues", async () => {
  const worker = await readFile("lib/digital/excerpt-worker.ts", "utf8"), service = await readFile("lib/digital/excerpt-service.ts", "utf8"), script = await readFile("scripts/digital-excerpt-worker.ts", "utf8");
  assert.match(worker, /EXCERPT_SCOPE_REQUIRED/); assert.match(worker, /validateDigitalAudio/); assert.match(worker, /scope: "private"/);
  assert.match(worker, /hash\.digest\("hex"\) !== details\.binding\.sourceSha256/);
  assert.match(worker, /renewDigitalSlot/); assert.match(worker, /releaseDigitalSlot/); assert.match(worker, /digitalWorkSlot\.updateMany/);
  assert.doesNotMatch(worker + service, /digitalMaster\.(?:create|update)|digitalEntitlement\.(?:create|update)|digitalOffer\.(?:create|update)|processDigitalMedia|generateDigitalMp3/);
  assert.match(script, /127\.0\.0\.1/); assert.match(script, /lnx_dcn_france_commercial_test_20261015/); assert.match(script, /External HTTP is forbidden/);
  for (const route of ["masters", "excerpts", "excerpt-candidates"]) {
    const code = await readFile(`app/api/admin/digital/${route}/[id]/route.ts`, "utf8");
    assert.match(code, /digitalActor\(request, true\)/); assert.match(code, /digitalRateLimit/);
    if (route !== "excerpts") { assert.match(code, /catalogAudioResponse/); assert.match(code, /private, no-store/); assert.match(code, /async function HEAD/); assert.match(code, /same-origin/); }
  }
  assert.equal(DIGITAL_EXCERPT_POLICY, "dcn-private-excerpt-selection-v1");
});

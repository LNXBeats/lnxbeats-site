import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { loadExpressProject, publishExpressProject } from "@/lib/digital/express-service";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_EXCERPT_EVENT } from "@/lib/digital/excerpt-policy";
import { DIGITAL_RIGHTS_REVIEW_EVENT } from "@/lib/digital/rights-review-policy";
import { GROUP_LISTEN_RECEIPT } from "@/lib/digital/group-review-policy";
import { OWNER_EXCERPTS_AT_PUBLICATION_POLICY, OWNER_PUBLICATION_POLICY } from "@/lib/digital/owner-declaration";

/** Transaction/repository doubles only. No PostgreSQL, storage, browser, email or
 * provider call; these assertions are not presented as authentic listening. */
function fixture() {
  const projectId = randomUUID(), trackId = randomUUID(), actor: OrderActor = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true,
    name: "Synthetic publication reviewer", email: "publication-transaction@example.invalid" };
  const asset = (mimeType: string, visibility = "PRIVATE", durationMs = 125_960) => ({ id: randomUUID(), type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW",
    mimeType, visibility, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 400_000n, rightsStatus: "PENDING" });
  const wav = asset("audio/wav"), mp3 = asset("audio/mpeg"), preview = asset("audio/mpeg", "PUBLIC", 59_950);
  const master = { id: randomUUID(), trackId, version: 1, masterAssetId: wav.id, mp3AssetId: mp3.id, previewAssetId: preview.id,
    masterAsset: wav, mp3Asset: mp3, previewAsset: preview, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    mp3BitrateKbps: 320, previewStartMs: 0, previewDurationMs: 59_950, track: { projectId, title: "Synthetic single" } };
  const track = { id: trackId, projectId, title: "Synthetic single", position: 1, status: "ANNOUNCED", durationSeconds: 126, credits: [], digitalMasters: [master] };
  const offer = { id: randomUUID(), scope: "TRACK", trackId, projectId, priceCents: 129, version: 1, active: false, rightsConfirmed: false, distribution: "UNRELEASED" };
  const project = { id: projectId, slug: "synthetic-transaction-single", title: track.title, type: "SINGLE", status: "DRAFT", publicVisible: false,
    releaseDate: null, membersPreviewEnabled: false, updatedAt: new Date("2026-10-23T08:00:00.000Z"), tracks: [track], digitalOffers: [offer],
    credits: [{ name: "LNX Beats Studio", role: "ARTIST" }, { name: "Ludovic Mickaël Mathon", role: "COMPOSER" }], assets: [{ asset: { id: randomUUID(), rightsStatus: "CLEARED" } }] };
  type Event = { id: string; actorId: string | null; kind: string; externalKey?: string; createdAt: Date; details: Record<string, unknown> };
  let state = { project, events: [] as Event[], publications: [] as unknown[] };
  const operations: string[] = [];
  let failActivation = false;
  const currentMaster = () => state.project.tracks[0].digitalMasters[0];
  const currentOffer = () => state.project.digitalOffers[0];
  const eventMatches = (event: Event, where: { kind?: string; actorId?: string; details?: { path: string[]; equals: unknown } }) => {
    if (where.kind && event.kind !== where.kind || where.actorId && event.actorId !== where.actorId) return false;
    const path = where.details?.path;
    return !path || path.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, event.details) === where.details!.equals;
  };
  const newest = (events: Event[]) => [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const db = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("dcn-excerpt-current-masters")) return [{ id: currentMaster().id, trackId }];
      if (sql.includes("dcn-excerpt-latest-artistic-events")) {
        const event = newest(state.events.filter(e => e.kind === DIGITAL_EXCERPT_EVENT));
        return event ? [{ ...event, masterId: currentMaster().id }] : [];
      }
      return [];
    },
    user: { findUnique: async () => actor, findMany: async () => [actor] },
    project: { findUnique: async () => state.project, findUniqueOrThrow: async () => state.project,
      update: async ({ data }: { data: Partial<typeof project> }) => { operations.push("project"); Object.assign(state.project, data); return state.project; } },
    track: { findFirst: async () => state.project.tracks[0],
      updateMany: async ({ data }: { data: Partial<typeof track> }) => { operations.push("track"); Object.assign(state.project.tracks[0], data); return { count: 1 }; } },
    credit: { findMany: async () => state.project.credits },
    digitalMaster: { findUnique: async () => currentMaster(), findFirst: async () => currentMaster(), findMany: async () => [currentMaster()] },
    digitalOffer: { findFirst: async () => currentOffer(), findMany: async () => [{ ...currentOffer(), project: state.project }],
      update: async ({ data }: { data: Partial<typeof offer> }) => { operations.push("offer"); if (failActivation) throw Error("SYNTHETIC_ACTIVATION_REFUSED"); Object.assign(currentOffer(), data); return currentOffer(); } },
    asset: { updateMany: async () => {
      operations.push("asset"); for (const a of [currentMaster().masterAsset, currentMaster().mp3Asset, currentMaster().previewAsset]) a.rightsStatus = "CLEARED";
      return { count: 3 };
    } },
    digitalEvent: {
      findUnique: async ({ where }: { where: { externalKey: string } }) => state.events.find(event => event.externalKey === where.externalKey) ?? null,
      findFirst: async ({ where }: { where: Parameters<typeof eventMatches>[1] }) => newest(state.events.filter(event => eventMatches(event, where))),
      findMany: async ({ where }: { where: Parameters<typeof eventMatches>[1] }) => state.events.filter(event => eventMatches(event, where)),
      create: async ({ data }: { data: Omit<Event, "id" | "createdAt"> & { createdAt?: Date } }) => {
        operations.push(data.kind); const event: Event = { ...data, id: randomUUID(), createdAt: data.createdAt ?? new Date() }; state.events.push(event); return event;
      },
    },
    releasePublication: { createMany: async ({ data }: { data: unknown[] }) => { operations.push("publication-alert"); state.publications.push(...data); return { count: data.length }; } },
  } as unknown as Prisma.TransactionClient;
  const transaction = async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await callback(db); } catch (error) { state = before; throw error; }
  };
  const input = async () => ({ projectId, reviewToken: (await loadExpressProject(projectId, db)).reviewToken, confirmed: true,
    idempotencyKey: randomUUID(), publishMode: "SALE" as const, rightsDeclaration: OWNER_PUBLICATION_POLICY, artisticDeclaration: OWNER_EXCERPTS_AT_PUBLICATION_POLICY });
  return { actor, db, operations, transaction, input, state: () => state, failActivation: () => { failActivation = true; } };
}

async function isolated<T>(f: ReturnType<typeof fixture>, run: () => Promise<T>) {
  const keys = ["DCN_ENABLED", "DCN_MODE", "DCN_GROUP_REVIEW_ENABLED", "DCN_DISCOGRAPHY_PREPARATION_ENABLED", "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]])), transaction = prisma.$transaction;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_GROUP_REVIEW_ENABLED: "true", DCN_DISCOGRAPHY_PREPARATION_ENABLED: "false" });
  for (const key of keys.slice(4)) delete process.env[key];
  prisma.$transaction = f.transaction as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("Express read prepares final declarations without writing listening, rights or publication", async () => {
  const f = fixture(); await isolated(f, async () => {
    const view = await loadExpressProject(f.state().project.id, f.db);
    assert.deepEqual(view.blockers, []); assert.equal(view.tracks[0].artisticAtPublication, true);
    assert.equal(view.tracks[0].artisticStatus, "TO_LISTEN"); assert.equal(view.tracks[0].review?.status, "REVIEW_REQUIRED");
    assert.deepEqual(f.operations, []); assert.equal(f.state().events.length, 0); assert.equal(f.state().project.digitalOffers[0].active, false);
  });
});

test("Express final publication requires both explicit decisions before any persistent mutation", async () => {
  const f = fixture(); await isolated(f, async () => {
    const input = await f.input();
    await assert.rejects(publishExpressProject(f.actor, { ...input, artisticDeclaration: undefined }), { code: "EXCERPT_ATTESTATION_REQUIRED" });
    await assert.rejects(publishExpressProject(f.actor, { ...input, rightsDeclaration: undefined }), { code: "EXPRESS_RIGHTS_CONFIRMATION_REQUIRED" });
    assert.equal(f.state().events.length, 0); assert.equal(f.state().project.publicVisible, false);
  });
});

test("Express exact final confirmation records rights then artistic decision then activates the controlled offer once", async () => {
  const f = fixture(); await isolated(f, async () => {
    const input = await f.input(); await publishExpressProject(f.actor, input);
    const rights = f.operations.indexOf(DIGITAL_RIGHTS_REVIEW_EVENT), artistic = f.operations.indexOf(DIGITAL_EXCERPT_EVENT), offer = f.operations.indexOf("offer");
    assert.ok(rights >= 0 && artistic > rights && offer > artistic);
    const decisions = f.state().events.filter(e => e.kind === DIGITAL_EXCERPT_EVENT);
    assert.equal(decisions.length, 1); assert.equal(decisions[0].details.provenance, "OWNER_DECLARED"); assert.equal(decisions[0].details.receiptId, null);
    assert.equal(f.state().events.filter(e => e.kind === GROUP_LISTEN_RECEIPT).length, 0);
    const view = await loadExpressProject(input.projectId, f.db); assert.equal(view.tracks[0].artisticStatus, "VALIDATED"); assert.equal(view.tracks[0].review?.status, "APPROVED");
    assert.equal(view.tracks[0].offer?.active, true); assert.equal(view.tracks[0].offer?.priceCents, 129);
    const count = f.state().events.length;
    assert.equal((await publishExpressProject(f.actor, input)).duplicate, true); assert.equal(f.state().events.length, count);
    for (const patch of [{ rightsDeclaration: undefined }, { artisticDeclaration: undefined }, { publishMode: "PREMIERE" as const }]) {
      await assert.rejects(publishExpressProject(f.actor, { ...input, ...patch }), { code: "IDEMPOTENCY_CONFLICT" });
    }
  });
});

test("Express an activation failure rolls back both declarations, visibility, offers and alerts", async () => {
  const f = fixture(); await isolated(f, async () => {
    const before = structuredClone(f.state()), input = await f.input(); f.failActivation();
    await assert.rejects(publishExpressProject(f.actor, input), /SYNTHETIC_ACTIVATION_REFUSED/);
    assert.ok(f.operations.includes(DIGITAL_RIGHTS_REVIEW_EVENT)); assert.ok(f.operations.includes(DIGITAL_EXCERPT_EVENT));
    assert.deepEqual(f.state(), before);
    const view = await loadExpressProject(input.projectId, f.db); assert.equal(view.tracks[0].artisticStatus, "TO_LISTEN"); assert.equal(view.tracks[0].review?.status, "REVIEW_REQUIRED");
  });
});

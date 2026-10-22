import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { expressDraft } from "@/lib/digital/express-policy";
import { recoverExpressAttempt } from "@/lib/digital/express-presentation";
import { loadExpressProject, saveExpressDraft } from "@/lib/digital/express-service";

const draft = () => ({ projectId: null, expectedUpdatedAt: null, title: "Single synthétique", type: "SINGLE", tracks: [{ id: null, title: "Single synthétique", priceCents: 129, expectedOfferVersion: 0 }], albumPriceCents: 990, expectedAlbumOfferVersion: 0, idempotencyKey: randomUUID() });
test("Guided release date is an exact optional UTC calendar date, never an invented schedule", () => {
  assert.equal("releaseDate" in expressDraft(draft()), false);
  for (const releaseDate of [null, "2028-02-29", "2020-01-01", "2030-12-31"]) assert.equal(expressDraft({ ...draft(), releaseDate }).releaseDate, releaseDate);
  for (const releaseDate of [undefined, "", "2027-02-29", "2028-02-30", "2028-13-01", "2028-1-01", "2028-01-01T00:00:00Z", true]) assert.throws(() => expressDraft({ ...draft(), releaseDate }));
});
test("Members preview is explicit, defaults to absence for old clients, and cannot mint visibility or sales", () => {
  assert.equal("membersPreviewEnabled" in expressDraft(draft()), false);
  for (const membersPreviewEnabled of [true, false]) assert.equal(expressDraft({ ...draft(), membersPreviewEnabled }).membersPreviewEnabled, membersPreviewEnabled);
  for (const membersPreviewEnabled of [null, undefined, "true", 1]) assert.throws(() => expressDraft({ ...draft(), membersPreviewEnabled }));
  assert.throws(() => expressDraft({ ...draft(), membersPreviewEnabled: true, publicVisible: true }));
  assert.throws(() => expressDraft({ ...draft(), releaseDate: "2030-01-01", active: true }));
});
test("Interrupted guided request retains the exact date, preview choice, prices and idempotency key", () => {
  const input = { ...draft(), releaseDate: "2030-01-01", membersPreviewEnabled: true };
  assert.deepEqual(recoverExpressAttempt(JSON.parse(JSON.stringify(input)), null), input);
  assert.deepEqual(recoverExpressAttempt(draft(), null)?.tracks[0].priceCents, 129);
});

/** Repository doubles only: no PostgreSQL connection or actual catalogue write. */
function fixture() {
  const projectId = randomUUID(), trackId = randomUUID(), offerId = randomUUID();
  const actor: OrderActor = { id: randomUUID(), name: "Synthetic QA Admin", email: "guided@example.invalid", role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const track = { id: trackId, title: "Single synthétique", position: 1, status: "ANNOUNCED", durationSeconds: null, credits: [], digitalMasters: [] };
  const offer = { id: offerId, projectId, trackId, scope: "TRACK", priceCents: 129, version: 1, active: false, rightsConfirmed: false, distribution: "UNRELEASED" };
  const credits: Array<{ id: string; name: string; role: string; note?: string; position?: number }> = [];
  const project = { id: projectId, slug: "guided-synthetic-only", title: track.title, type: "SINGLE", status: "DRAFT", publicVisible: false,
    releaseDate: new Date("2026-04-19T00:00:00.000Z"), membersPreviewEnabled: false, updatedAt: new Date("2026-10-22T10:00:00.000Z"), tracks: [track], digitalOffers: [offer], credits, assets: [] };
  const projectWrites: Array<Record<string, unknown>> = [], events: Array<{ actorId: string; kind: string; externalKey: string; details: Record<string, unknown> }> = [];
  const db = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ ...actor }) },
    project: { findUniqueOrThrow: async () => project, findUnique: async () => project,
      update: async ({ data }: { data: Record<string, unknown> }) => { projectWrites.push(data); Object.assign(project, data); project.updatedAt = new Date(project.updatedAt.getTime() + 1); return project; } },
    track: { findFirst: async () => track, update: async ({ data }: { data: Partial<typeof track> }) => { Object.assign(track, data); return track; } },
    digitalOffer: { findFirst: async () => offer },
    credit: { findMany: async () => credits, aggregate: async () => ({ _max: { position: credits.length } }),
      create: async ({ data }: { data: Omit<(typeof credits)[number], "id"> }) => { const credit = { ...data, id: randomUUID() }; credits.push(credit); return credit; } },
    memberPremiereVote: { groupBy: async () => [] },
    digitalEvent: { findUnique: async ({ where }: { where: { externalKey: string } }) => events.find(event => event.externalKey === where.externalKey) ?? null,
      findFirst: async ({ where }: { where: { AND?: unknown } }) => [...events].reverse().find(event => !where.AND || "hasCollaborations" in event.details) ?? null,
      create: async ({ data }: { data: (typeof events)[number] }) => { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const input = () => ({ ...draft(), projectId, expectedUpdatedAt: project.updatedAt.toISOString(), tracks: [{ id: trackId, title: track.title, priceCents: 129, expectedOfferVersion: 1 }] });
  return { actor, project, db, projectWrites, events, input };
}
async function isolated<T>(db: Prisma.TransactionClient, run: () => Promise<T>) {
  const keys = ["DCN_ENABLED", "DCN_MODE", "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])), transaction = prisma.$transaction;
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" });
  for (const key of keys.slice(2)) delete process.env[key];
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(db)) as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
test("Saving from an old client does not clear an existing date or enable members preview", async () => {
  const f = fixture();
  await isolated(f.db, () => saveExpressDraft(f.actor, f.input()));
  assert.equal(f.project.releaseDate.toISOString(), "2026-04-19T00:00:00.000Z"); assert.equal(f.project.membersPreviewEnabled, false);
  assert.ok(f.projectWrites.every(write => !("releaseDate" in write) && !("membersPreviewEnabled" in write)));
  assert.equal(f.project.digitalOffers[0].priceCents, 129); assert.equal(f.project.digitalOffers[0].active, false);
});
test("An explicit new date persists once with its old/new audit, without touching offers, audio or existing reviews", async () => {
  const f = fixture(), request = { ...f.input(), releaseDate: "2030-02-01", membersPreviewEnabled: true };
  await isolated(f.db, async () => {
    await saveExpressDraft(f.actor, request);
    assert.equal((await saveExpressDraft(f.actor, request)).duplicate, true);
    const view = await loadExpressProject(f.project.id, f.db);
    assert.equal(view.releaseDate, "2030-02-01"); assert.equal(view.membersPreviewEnabled, true);
  });
  assert.equal(f.events.length, 1); assert.deepEqual(f.events[0].details.releaseDateChange, { from: "2026-04-19", to: "2030-02-01", purpose: "PLATFORM_RELEASE_METADATA_ONLY" });
  assert.deepEqual(f.events[0].details.membersPreviewChange, { from: false, to: true, salesActivated: false });
  assert.equal(f.project.digitalOffers[0].active, false); assert.equal(f.project.digitalOffers[0].rightsConfirmed, false); assert.equal(f.project.digitalOffers[0].priceCents, 129);
  assert.equal(f.project.publicVisible, false); assert.equal(f.project.status, "DRAFT");
});
test("Stale date save is rejected before any metadata write; an explicit null alone clears the date", async () => {
  const f = fixture();
  await isolated(f.db, async () => {
    await assert.rejects(saveExpressDraft(f.actor, { ...f.input(), expectedUpdatedAt: "2020-01-01T00:00:00.000Z", releaseDate: "2030-01-01" }), { code: "EXPRESS_CHANGED" });
    assert.equal(f.projectWrites.length, 0);
    await saveExpressDraft(f.actor, { ...f.input(), releaseDate: null });
  });
  assert.equal(f.project.releaseDate, null); assert.deepEqual(f.events[0].details.releaseDateChange, { from: "2026-04-19", to: null, purpose: "PLATFORM_RELEASE_METADATA_ONLY" });
});
test("Saving a member-preview choice cannot suspend or reinterpret existing active offers", async () => {
  const f = fixture(); f.project.digitalOffers[0].active = true;
  await isolated(f.db, async () => {
    await assert.rejects(saveExpressDraft(f.actor, { ...f.input(), releaseDate: "2030-01-01", membersPreviewEnabled: true }), { code: "EXPRESS_ACTIVE_OFFER" });
  });
  assert.equal(f.projectWrites.length, 0); assert.equal(f.events.length, 0); assert.equal(f.project.membersPreviewEnabled, false);
  assert.equal(f.project.digitalOffers[0].active, true); assert.equal(f.project.releaseDate.toISOString(), "2026-04-19T00:00:00.000Z");
});
test("An explicit private Express save adds owner credits once and audits them without granting rights or activating offers", async () => {
  const f = fixture();
  f.events.push({ actorId: f.actor.id, kind: "MUSIC_EXPRESS_DRAFT", externalKey: "fixture-existing-draft", details: { projectId: f.project.id } });
  const request = { ...f.input(), hasCollaborations: false };
  await isolated(f.db, async () => {
    await saveExpressDraft(f.actor, request);
    assert.equal((await saveExpressDraft(f.actor, request)).duplicate, true);
    await saveExpressDraft(f.actor, { ...f.input(), hasCollaborations: false });
  });
  assert.deepEqual(f.project.credits.map(c => [c.name, c.role]), [["LNX Beats Studio", "ARTIST"], ["Ludovic Mickaël Mathon", "COMPOSER"]]);
  assert.equal(f.events.length, 3);
  const audit = f.events[1].details.ownerCredits as { creditIds: string[]; independentRightsEvidence: boolean };
  assert.deepEqual(audit.creditIds, f.project.credits.map(c => c.id)); assert.equal(audit.independentRightsEvidence, false);
  assert.equal(f.project.digitalOffers[0].active, false); assert.equal(f.project.digitalOffers[0].rightsConfirmed, false);
});
test("Collaborations preserve existing people and legal roles instead of attributing composition automatically", async () => {
  const f = fixture();
  f.events.push({ actorId: f.actor.id, kind: "MUSIC_EXPRESS_DRAFT", externalKey: "fixture-existing-draft", details: { projectId: f.project.id } });
  const guest = { id: randomUUID(), name: "Synthetic Guest", role: "FEATURING" };
  f.project.credits.push(guest);
  await isolated(f.db, async () => {
    await saveExpressDraft(f.actor, { ...f.input(), hasCollaborations: true });
    assert.equal((await loadExpressProject(f.project.id, f.db)).hasCollaborations, true);
  });
  assert.deepEqual(f.project.credits.map(c => [c.name, c.role]), [[guest.name, "FEATURING"], ["LNX Beats Studio", "ARTIST"]]);
  assert.deepEqual(f.project.credits[0], guest);
});
test("Credit defaults never rewrite an existing published identity or unrelated private catalogue project", async () => {
  for (const published of [false, true]) {
    const f = fixture();
    if (published) { f.project.status = "PUBLISHED"; f.project.publicVisible = true; }
    await isolated(f.db, () => saveExpressDraft(f.actor, { ...f.input(), hasCollaborations: false }));
    assert.deepEqual(f.project.credits, []); assert.equal(f.events[0].details.ownerCredits, undefined);
  }
});
test("Default member-premiere publication preserves offers; only explicit SALE enters the existing commercial gates", async () => {
  const service = await readFile(new URL("../../lib/digital/express-service.ts", import.meta.url), "utf8");
  const start = service.indexOf("if (review.membersPreviewEnabled) {"), end = service.indexOf("return { ok: true, duplicate: false, published: true, premiere: true };", start);
  assert.ok(start > -1 && end > start); const branch = service.slice(start, end);
  const authorization = branch.indexOf("await authorizeMemberPremiereExcerpts(db, input.projectId, actor.id);"),
    readiness = branch.indexOf("await assertMemberPremiereReady(db, input.projectId);"),
    publicationEvent = branch.indexOf('kind: "MUSIC_EXPRESS_PREMIERE_PUBLISHED"'),
    announcement = branch.indexOf('await enqueueReleasePublication(db, { kind: "MUSIC", resourceId: input.projectId });');
  assert.ok(authorization > -1 && readiness > authorization && publicationEvent > readiness && announcement > publicationEvent);
  assert.match(branch, /actorId: actor\.id, externalKey: key/); assert.match(branch, /premiereBinding: premiere!?\.binding/);
  assert.match(branch, /memberOnly: true/); assert.match(branch, /offerIds: \[\], salesActivated: false/);
  assert.match(branch, /review\.membersPreviewEnabled && input\.publishMode !== "SALE"/);
  assert.doesNotMatch(branch, /saveOfferInTransaction|track\.updateMany|active: true/);
  const commercial = service.slice(end);
  assert.ok(commercial.indexOf("await enqueueReleasePublication(db, { kind: \"MUSIC\", resourceId: p.id });") > commercial.indexOf("for (const id of ids) await selections([id], db);"));
  assert.match(commercial, /workflow: "EXPLICIT_SALE_WITH_MEMBER_EXCERPTS"/);
  assert.match(commercial, /delivery: "IMMEDIATE_AFTER_CONFIRMED_PAYMENT"/);
  assert.match(service, /\(details\.requestedMode \?\? null\) !== \(input\.publishMode \?\? null\)/);
});
test("Studio defaults on only after server capability resolution, without choosing files, uploading or restoring human consents", async () => {
  const ui = await readFile(new URL("../../components/music-express.tsx", import.meta.url), "utf8");
  assert.match(ui, /\[studioRequested, setStudioRequested\] = useState\(true\)/);
  assert.match(ui, /setStudioEnabled\(enabled\); setStudioAvailabilityKnown\(true\)/);
  assert.match(ui, /studioAvailabilityKnown \? <DigitalBatchUpload/); assert.match(ui, /studio=\{studioEnabled && studioRequested\}/);
  assert.match(ui, /studio=\{studioEnabled && studioRequested\}/);
  assert.match(ui, /Publication prévue sur les plateformes/); assert.match(ui, /type="date" value=\{releaseDate\}/);
  assert.match(ui, /initial\?\.membersPreviewEnabled \?\? false/); assert.match(ui, /Avant-première réservée aux membres/);
  assert.doesNotMatch(ui, /setMembersPreviewEnabled\(cached\./);
  assert.match(ui, /OWNER_ORIGINAL_CONFIRMATION/); assert.match(ui, /rightsDeclaration: OWNER_PUBLICATION_POLICY/);
});

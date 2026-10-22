import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expressCollaborationEditable, expressCollaborationInput } from "../../lib/digital/express-collaborations-policy";
import { saveExpressCollaborationInTransaction } from "../../lib/digital/express-collaborations";
import type { OrderActor } from "../../lib/orders/domain";

const projectId = randomUUID(), artistId = randomUUID(), composerId = randomUUID(), trackId = randomUUID(), actor = { id: randomUUID(), role: "ADMIN" } as OrderActor;
const revision = "2026-10-23T10:00:00.000Z";
const creditInput = () => ({ operation: "credit", projectId, expectedUpdatedAt: revision, idempotencyKey: randomUUID(), id: artistId, trackId: null as string | null, name: "Artiste invité", role: "ARTIST" });
const linkInput = () => ({ operation: "link", projectId, expectedUpdatedAt: revision, idempotencyKey: randomUUID(), id: null, platform: "spotify", scope: "RELEASE", url: "https://open.spotify.com/album/qa", label: "Écouter cette collaboration" });

test("collaboration editor accepts factual artistic roles and exact destination IDs only", () => {
  assert.equal(expressCollaborationInput(creditInput()).operation, "credit");
  assert.equal(expressCollaborationInput({ ...creditInput(), role: "FEATURING", trackId }).operation, "credit");
  for (const role of ["WRITER", "COMPOSER", "PRODUCER", "ENGINEER", "OTHER", "admin"]) assert.throws(() => expressCollaborationInput({ ...creditInput(), role }));
  for (const extra of ["rightsApproved", "active", "delete", "masterId", "publicVisible"]) assert.throws(() => expressCollaborationInput({ ...creditInput(), [extra]: true }));
  for (const patch of [{ id: "foreign" }, { trackId: "foreign" }, { expectedUpdatedAt: "yesterday" }, { name: " " }]) assert.throws(() => expressCollaborationInput({ ...creditInput(), ...patch }));
});
test("collaboration links reuse HTTPS/platform validation and reject historical Etsy mutation", () => {
  assert.equal(expressCollaborationInput(linkInput()).operation, "link");
  for (const url of ["http://open.spotify.com/album/qa", "https://youtube.com/album/qa", "https://secret@open.spotify.com/album/qa", "javascript:alert(1)"]) assert.throws(() => expressCollaborationInput({ ...linkInput(), url }));
  for (const patch of [{ platform: "etsy" }, { scope: "GLOBAL" }, { platform: "other", url: "https://www.etsy.com/shop/qa" }]) assert.throws(() => expressCollaborationInput({ ...linkInput(), ...patch }));
});
test("only private non-commercial drafts are editable; published, announced and active editions are protected", () => {
  assert.equal(expressCollaborationEditable({ status: "DRAFT", publicVisible: false, digitalOffers: [{ active: false }] }), true);
  for (const patch of [{ status: "PUBLISHED" }, { status: "IN_DEVELOPMENT" }, { publicVisible: true }, { digitalOffers: [{ active: true }] }]) assert.equal(expressCollaborationEditable({ status: "DRAFT", publicVisible: false, digitalOffers: [], ...patch }), false);
});

function fixture() {
  const credits = [{ id: artistId, projectId, trackId: null as string | null, name: "Ancien nom artistique", role: "ARTIST", position: 1, note: "Preuve ancienne conservée", confidence: "CONFIRMED" }, { id: composerId, projectId, trackId: null, name: "Compositeur documenté", role: "COMPOSER", position: 2, note: "Pièce légale", confidence: "CONFIRMED" }];
  const links: Array<{ id: string; projectId: string; platform: string; scope: string; url: string; label: string | null; position: number; confidence: string }> = [];
  const events = new Map<string, { actorId: string; details: Record<string, unknown> }>();
  const writes: string[] = [];
  const p = { id: projectId, slug: "collaboration-qa", status: "DRAFT", publicVisible: false, updatedAt: new Date(revision), digitalOffers: [] as { active: boolean }[], tracks: [{ id: trackId, title: "Piste exacte" }], platformLinks: links };
  const user = { id: actor.id, role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const db = {
    $queryRaw: async () => [], user: { findUnique: async () => user },
    project: { findUnique: async () => p, update: async ({ data }: { data: { updatedAt: Date } }) => { writes.push("project-version"); p.updatedAt = data.updatedAt; return p; } },
    credit: { findMany: async ({ where }: { where: { trackId?: string } }) => where.trackId ? credits.filter(c => c.trackId === where.trackId) : credits,
      update: async ({ where, data }: { where: { id: string }; data: { name: string; role: string } }) => { writes.push("credit"); const c = credits.find(c => c.id === where.id)!; Object.assign(c, data); return c; },
      create: async ({ data }: { data: Omit<typeof credits[number], "id"> }) => { writes.push("credit"); const c = { id: randomUUID(), ...data }; credits.push(c); return c; } },
    platformLink: { findUnique: async ({ where }: { where: { url: string } }) => links.find(l => l.url === where.url) ?? null,
      create: async ({ data }: { data: Omit<typeof links[number], "id"> }) => { writes.push("link"); const l = { id: randomUUID(), ...data }; links.push(l); return l; } },
    digitalEvent: { findUnique: async ({ where }: { where: { externalKey: string } }) => events.get(where.externalKey) ?? null,
      create: async ({ data }: { data: { externalKey: string; actorId: string; details: Record<string, unknown> } }) => { writes.push("audit"); events.set(data.externalKey, data); return data; } },
  };
  return { db: db as unknown as Parameters<typeof saveExpressCollaborationInTransaction>[0], p, credits, links, events, writes, user };
}

test("artistic change preserves composer, notes, IDs and immutable before/after audit without touching media, rights or offers", async () => {
  const f = fixture(), legalBefore = { ...f.credits[1] };
  const input = expressCollaborationInput(creditInput());
  const result = await saveExpressCollaborationInTransaction(f.db, actor, input);
  assert.equal(result.duplicate, false); assert.equal(f.credits[0].id, artistId); assert.equal(f.credits[0].note, "Preuve ancienne conservée");
  assert.deepEqual(f.credits[1], legalBefore);
  const details = [...f.events.values()][0].details;
  assert.equal((details.before as { name: string }).name, "Ancien nom artistique"); assert.equal((details.after as { name: string }).name, "Artiste invité");
  assert.equal(details.independentRightsEvidence, false); assert.equal(details.rightsApproved, false); assert.equal(details.mediaChanged, false); assert.equal(details.offersChanged, false);
  assert.deepEqual(f.writes, ["credit", "project-version", "audit"]);
  await saveExpressCollaborationInTransaction(f.db, actor, input);
  assert.equal(f.events.size, 1); assert.equal(f.writes.length, 3);
  await assert.rejects(saveExpressCollaborationInTransaction(f.db, actor, { ...input, ...input.operation === "credit" ? { name: "Autre" } : {} }), /IDEMPOTENCY_CONFLICT/);
});
test("authentication, stale revisions, protected editions, legal rows and foreign tracks fail before writes", async () => {
  for (const mode of ["auth", "stale", "public", "active", "legal", "foreign"] as const) {
    const f = fixture(); let raw = creditInput();
    if (mode === "auth") f.user.status = "DISABLED";
    if (mode === "stale") f.p.updatedAt = new Date("2026-10-23T10:00:01.000Z");
    if (mode === "public") f.p.publicVisible = true;
    if (mode === "active") f.p.digitalOffers.push({ active: true });
    if (mode === "legal") raw = { ...raw, id: composerId };
    if (mode === "foreign") raw = { ...raw, trackId: randomUUID() };
    await assert.rejects(saveExpressCollaborationInTransaction(f.db, actor, expressCollaborationInput(raw)));
    assert.equal(f.writes.length, 0, mode);
  }
});
test("platform addition is exact and audited, and a duplicate platform/scope cannot be created", async () => {
  const f = fixture();
  await saveExpressCollaborationInTransaction(f.db, actor, expressCollaborationInput(linkInput()));
  assert.equal(f.links.length, 1); assert.equal(f.links[0].platform, "SPOTIFY"); assert.equal(f.links[0].scope, "RELEASE");
  await assert.rejects(saveExpressCollaborationInTransaction(f.db, actor, expressCollaborationInput({ ...linkInput(), expectedUpdatedAt: f.p.updatedAt.toISOString(), url: "https://open.spotify.com/album/other" })), /EXPRESS_DUPLICATE/);
  assert.equal(f.links.length, 1); assert.equal(f.events.size, 1);
});
test("duplicate artist rows are refused before mutation while distinct artistic/legal roles remain separate", async () => {
  const f = fixture();
  await assert.rejects(saveExpressCollaborationInTransaction(f.db, actor, expressCollaborationInput({ ...creditInput(), id: null, name: "ANCIEN NOM ARTISTIQUE" })), /EXPRESS_DUPLICATE/);
  assert.equal(f.writes.length, 0); assert.equal(f.credits.length, 2);
  await saveExpressCollaborationInTransaction(f.db, actor, expressCollaborationInput({ ...creditInput(), id: null, name: "Autre artiste", role: "FEATURING", trackId }));
  assert.equal(f.credits.length, 3); assert.equal(f.credits[2].role, "FEATURING"); assert.equal(f.credits[2].trackId, trackId);
  assert.equal(f.credits[1].role, "COMPOSER");
});

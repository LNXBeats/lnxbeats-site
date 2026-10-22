import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { isEtsyCatalogLink } from "@/lib/catalog/public-link-policy";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment } from "./domain";
import { requireDigitalExcerptAdmin } from "./excerpt-service";
import { collaborationPlatforms, expressCollaborationEditable, expressCollaborationInput, type CollaborationMutation } from "./express-collaborations-policy";

type DB = Prisma.TransactionClient;
const include = { digitalOffers: { select: { active: true } }, tracks: { orderBy: { position: "asc" as const }, select: { id: true, title: true } }, platformLinks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] } };
export async function loadExpressCollaborations(projectId: string, db: DB = prisma) {
  assertDigitalUuid(projectId);
  const p = await db.project.findUnique({ where: { id: projectId }, include });
  if (!p) throw new DigitalError("NOT_FOUND", 404);
  const credits = await db.credit.findMany({ where: { OR: [{ projectId, trackId: null }, { trackId: { in: p.tracks.map(t => t.id) } }] }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  return { projectId, slug: p.slug, updatedAt: p.updatedAt.toISOString(), editable: expressCollaborationEditable(p), tracks: p.tracks,
    credits: credits.map(c => ({ id: c.id, trackId: c.trackId, name: c.name, role: c.role, editable: c.role === "ARTIST" || c.role === "FEATURING" })),
    links: p.platformLinks.map(l => ({ id: l.id, platform: l.platform, scope: l.scope, label: l.label, url: l.url, editable: !isEtsyCatalogLink(l) })) };
}

export async function saveExpressCollaboration(actor: OrderActor, raw: unknown) {
  requireDigitalEnvironment(); const input = expressCollaborationInput(raw);
  return prisma.$transaction(db => saveExpressCollaborationInTransaction(db, actor, input), { timeout: 15_000 });
}

/** A narrow, append-audited metadata edit. No delete path, rights approval,
 * offer change or media rewrite is available here. */
export async function saveExpressCollaborationInTransaction(db: DB, actor: OrderActor, input: CollaborationMutation) {
  await requireDigitalExcerptAdmin(db, actor.id);
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${input.projectId}`})) IS NULL AS locked`;
  const externalKey = `music-express-collaboration:${input.idempotencyKey}`;
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = await db.digitalEvent.findUnique({ where: { externalKey } });
  if (previous) {
    const details = previous.details as { requestHash?: string };
    if (previous.actorId !== actor.id || details.requestHash !== requestHash) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
    return { duplicate: true, metadata: await loadExpressCollaborations(input.projectId, db) };
  }
  const p = await db.project.findUnique({ where: { id: input.projectId }, include });
  if (!p) throw new DigitalError("NOT_FOUND", 404);
  if (!expressCollaborationEditable(p)) throw new DigitalError("EXPRESS_PUBLIC_METADATA", 409);
  if (p.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new DigitalError("EXPRESS_CHANGED", 409);
  let before: Prisma.InputJsonValue | null = null, after: Prisma.InputJsonValue;
  if (input.operation === "credit") {
    if (input.trackId && !p.tracks.some(t => t.id === input.trackId)) throw new DigitalError("NOT_FOUND", 404);
    const scope = input.trackId ? { trackId: input.trackId } : { projectId: p.id, trackId: null };
    const existing = await db.credit.findMany({ where: scope });
    const current = input.id ? existing.find(c => c.id === input.id) : null;
    if (input.id && (!current || !["ARTIST", "FEATURING"].includes(current.role))) throw new DigitalError("EXPRESS_INVALID", 409);
    if (existing.some(c => c.id !== input.id && c.role === input.role && c.name.normalize("NFKC").trim().toLocaleLowerCase("fr") === input.name.normalize("NFKC").trim().toLocaleLowerCase("fr"))) throw new DigitalError("EXPRESS_DUPLICATE", 409);
    before = current ? { id: current.id, name: current.name, role: current.role, note: current.note, confidence: current.confidence, trackId: current.trackId } : null;
    const saved = current ? await db.credit.update({ where: { id: current.id }, data: { name: input.name, role: input.role } }) : await db.credit.create({ data: { projectId: input.trackId ? null : p.id, trackId: input.trackId, name: input.name, role: input.role, position: Math.max(0, ...existing.map(c => c.position)) + 1, confidence: "PARTIAL", note: "Crédit artistique renseigné explicitement dans Admin Express. Ne constitue pas une preuve indépendante de droits." } });
    after = { id: saved.id, name: saved.name, role: saved.role, trackId: saved.trackId };
  } else {
    const current = input.id ? p.platformLinks.find(l => l.id === input.id) : null;
    if (input.id && (!current || isEtsyCatalogLink(current))) throw new DigitalError("EXPRESS_INVALID", 409);
    const platform = collaborationPlatforms[input.platform];
    if (p.platformLinks.some(l => l.id !== input.id && l.platform === platform && l.scope === input.scope)) throw new DigitalError("EXPRESS_DUPLICATE", 409);
    const duplicateUrl = await db.platformLink.findUnique({ where: { url: input.url }, select: { id: true } });
    if (duplicateUrl && duplicateUrl.id !== input.id) throw new DigitalError("EXPRESS_DUPLICATE", 409);
    const values = { platform, scope: input.scope, url: input.url, label: input.label };
    before = current ? { id: current.id, platform: current.platform, scope: current.scope, url: current.url, label: current.label, confidence: current.confidence } : null;
    const saved = current ? await db.platformLink.update({ where: { id: current.id }, data: values }) : await db.platformLink.create({ data: { ...values, projectId: p.id, position: Math.max(-1, ...p.platformLinks.map(l => l.position)) + 1, confidence: "PARTIAL" } });
    after = { id: saved.id, ...values };
  }
  // Explicitly advance the optimistic version even when the clock has the same millisecond.
  await db.project.update({ where: { id: p.id }, data: { updatedAt: new Date(Math.max(Date.now(), p.updatedAt.getTime() + 1)), legacySourceVersion: null } });
  await db.digitalEvent.create({ data: { kind: "MUSIC_EXPRESS_COLLABORATION_METADATA", actorId: actor.id, externalKey, details: { projectId: p.id, operation: input.operation, requestHash, expectedUpdatedAt: input.expectedUpdatedAt, before, after, independentRightsEvidence: false, rightsApproved: false, mediaChanged: false, offersChanged: false } } });
  return { duplicate: false, metadata: await loadExpressCollaborations(input.projectId, db) };
}

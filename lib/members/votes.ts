import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDigitalUuid, DigitalError } from "@/lib/digital/domain";
import { premiereMemberAllowed } from "./premiere-policy";
import { publishedMemberPremiereBinding } from "./previews";

export type PremiereVoteChoice = "UP" | "DOWN" | null;
export type PremiereVoter = { id: string; status: string; emailVerified: boolean; role: string };
type DB = Prisma.TransactionClient;
/** Only aggregates escape this module; individual voters are never listed. */
export async function premiereVoteSummary(db: DB, projectId: string, binding: string) {
  const rows = await db.memberPremiereVote.groupBy({ by: ["choice"], where: { projectId, binding, choice: { in: ["UP", "DOWN"] },
    user: { status: "ACTIVE", emailVerified: true, role: { in: ["MEMBER", "CUSTOMER", "ADMIN"] } } }, _count: { _all: true } });
  return { up: rows.find(row => row.choice === "UP")?._count._all ?? 0, down: rows.find(row => row.choice === "DOWN")?._count._all ?? 0 };
}
async function voteContext(db: DB, actor: PremiereVoter, projectId: string, expectedBinding: string, now: Date) {
  assertDigitalUuid(projectId); assertDigitalUuid(actor.id);
  if (!/^[a-f0-9]{64}$/.test(expectedBinding)) throw new DigitalError("INVALID_BODY");
  if (!premiereMemberAllowed(actor)) throw new DigitalError("AUTH_REQUIRED", 401);
  // Recheck persisted access; a cached session cannot revive a suspended member.
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { status: true, emailVerified: true, role: true } });
  if (!premiereMemberAllowed(user)) throw new DigitalError("AUTH_REQUIRED", 401);
  const binding = await publishedMemberPremiereBinding(db, projectId, now);
  if (!binding) throw new DigitalError("NOT_FOUND", 404);
  if (binding !== expectedBinding) throw new DigitalError("STALE_PREMIERE", 409);
  return binding;
}
export async function getPremiereVote(actor: PremiereVoter, projectId: string, expectedBinding: string, database: PrismaClient = prisma, now = new Date()) {
  return database.$transaction(async db => {
    const binding = await voteContext(db, actor, projectId, expectedBinding, now);
    const existing = await db.memberPremiereVote.findUnique({ where: { projectId_userId_binding: { projectId, userId: actor.id, binding } }, select: { choice: true } });
    return { choice: (existing?.choice ?? null) as PremiereVoteChoice, ...await premiereVoteSummary(db, projectId, binding) };
  });
}
export async function savePremiereVote(actor: PremiereVoter, projectId: string, choice: PremiereVoteChoice, expectedBinding: string, database: PrismaClient = prisma, now = new Date()) {
  if (choice !== null && choice !== "UP" && choice !== "DOWN") throw new DigitalError("INVALID_BODY");
  return database.$transaction(async db => {
    const binding = await voteContext(db, actor, projectId, expectedBinding, now);
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`premiere-vote:${projectId}:${actor.id}:${binding}`})) IS NULL AS locked`;
    const where = { projectId_userId_binding: { projectId, userId: actor.id, binding } };
    const existing = await db.memberPremiereVote.findUnique({ where, select: { choice: true } });
    if (!existing && choice !== null) await db.memberPremiereVote.create({ data: { projectId, userId: actor.id, binding, choice } });
    else if (existing && existing.choice !== choice) await db.memberPremiereVote.update({ where, data: { choice } });
    return { choice, ...await premiereVoteSummary(db, projectId, binding) };
  });
}

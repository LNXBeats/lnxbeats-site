import "server-only";

import type { listAdminMembers } from "@/lib/admin/service";
import { requireMemberSignInAdmin } from "@/lib/admin/member-sign-in-policy";
import { lastSignInObservation } from "@/lib/auth/last-sign-in-policy";

type Member = Awaited<ReturnType<typeof listAdminMembers>>[number];
type SignInRow = { id: string; lastSignedInAt: Date | null; sessions: Array<{ createdAt: Date }> };
type Dependencies = { members(query: string): Promise<Member[]>; signIns(ids: string[]): Promise<SignInRow[]> };
const dependencies: Dependencies = {
  members: async query => (await import("@/lib/admin/service")).listAdminMembers(query),
  signIns: async ids => (await import("@/lib/prisma")).prisma.user.findMany({ where: { id: { in: ids } }, select: {
    id: true, lastSignedInAt: true,
    sessions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
  } }),
};

/** Private Admin projection. Do not expose sessions, credentials or observations
 * through the public account API; only the date/source reaches this screen. */
export async function listAdminMembersWithSignIns(
  actor: { role?: unknown; status?: unknown } | null | undefined,
  query = "",
  db: Dependencies = dependencies,
) {
  requireMemberSignInAdmin(actor);
  const members = await db.members(query);
  if (!members.length) return [];
  const observations = new Map((await db.signIns(members.map(m => m.id))).map(row => [row.id, lastSignInObservation(row.lastSignedInAt, row.sessions[0]?.createdAt)]));
  return members.map(member => ({ ...member, lastSignIn: observations.get(member.id) ?? lastSignInObservation(null, null) }));
}

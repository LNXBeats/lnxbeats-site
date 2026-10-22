import { canAccessAdmin, isActiveStatus } from "@/lib/auth/roles";

export function requireMemberSignInAdmin(actor: { role?: unknown; status?: unknown } | null | undefined) {
  if (!actor || !canAccessAdmin(actor.role) || !isActiveStatus(actor.status)) throw new Error("ADMIN_REQUIRED");
}

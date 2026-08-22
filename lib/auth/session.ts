import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { qaAccessIdentityAllowed } from "@/lib/auth/qa-access";
import { canAccessRole, isActiveStatus, type UserRole } from "@/lib/auth/roles";
import { assertDatabaseConfigured } from "@/lib/prisma";

export async function getAuthSession() {
  assertDatabaseConfigured();
  const session = await auth.api.getSession({ headers: await headers() });
  return session && qaAccessIdentityAllowed(session.user.id) ? session : null;
}

export async function requireUser(returnTo = "/compte") {
  const session = await getAuthSession();

  if (!session || !isActiveStatus(session.user.status)) {
    redirect(`/connexion?retour=${encodeURIComponent(returnTo)}`);
  }

  return session;
}

export async function requireVerifiedUser(returnTo = "/compte") {
  const session = await requireUser(returnTo);
  if (session.user.emailVerified !== true) {
    redirect("/renvoyer-verification");
  }
  return session;
}

export async function requireRole(allowedRoles: readonly UserRole[], returnTo: string) {
  const session = await requireUser(returnTo);

  if (!canAccessRole(session.user.role, allowedRoles)) {
    redirect("/compte?acces=refuse");
  }

  return session;
}

export function requireAdmin() {
  return requireRole(["ADMIN"], "/admin");
}

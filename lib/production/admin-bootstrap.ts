import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { ADMIN_PRINCIPAL_EMAIL } from "@/lib/auth/environment";
import { hashPassword } from "@/lib/auth/password";
import {
  ADMIN_PRODUCTION_CONFIRMATION,
  ProductionBootstrapError,
  assertProductionApply,
  assertProductionDatabaseEnvironment,
  maskEmail,
} from "@/lib/production/bootstrap-environment";

type Environment = Record<string, string | undefined>;

export type AdminBootstrapPlan = {
  existingUsers: number;
  existingAdmins: number;
  targetEmailMasked: string;
  action: "WOULD_CREATE" | "WOULD_PROMOTE" | "NONE";
  targetUserId: string | null;
};

function configuredTargetEmail(environment: Environment) {
  const email = environment.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || email !== ADMIN_PRINCIPAL_EMAIL) {
    throw new ProductionBootstrapError("ADMIN_EMAIL must identify the approved LNX Beats administrator account.");
  }
  return email;
}

async function inspect(client: PrismaClient, email: string): Promise<AdminBootstrapPlan> {
  const [existingUsers, existingAdmins, target] = await Promise.all([
    client.user.count(),
    client.user.count({ where: { role: "ADMIN" } }),
    client.user.findUnique({
      where: { email },
      select: { id: true, role: true, status: true, emailVerified: true, emailVerifiedAt: true },
    }),
  ]);
  if (target && (!target.emailVerified || !target.emailVerifiedAt || target.status !== "ACTIVE")) {
    throw new ProductionBootstrapError("The existing target account is not verified and active; it will not be modified.");
  }
  return {
    existingUsers,
    existingAdmins,
    targetEmailMasked: maskEmail(email),
    action: !target ? "WOULD_CREATE" : target.role === "ADMIN" ? "NONE" : "WOULD_PROMOTE",
    targetUserId: target?.id ?? null,
  };
}

export async function planProductionAdminBootstrap(
  client: PrismaClient,
  environment: Environment = process.env,
) {
  assertProductionDatabaseEnvironment(environment);
  return inspect(client, configuredTargetEmail(environment));
}

export async function applyProductionAdminBootstrap(
  client: PrismaClient,
  environment: Environment = process.env,
) {
  assertProductionDatabaseEnvironment(environment);
  assertProductionApply(true, "ADMIN_BOOTSTRAP_CONFIRM", ADMIN_PRODUCTION_CONFIRMATION, environment);
  const email = configuredTargetEmail(environment);
  const initial = await inspect(client, email);
  const password = environment.ADMIN_BOOTSTRAP_PASSWORD ?? "";
  if (initial.action === "WOULD_CREATE" && (password.length < 16 || password.length > 128)) {
    throw new ProductionBootstrapError("ADMIN_BOOTSTRAP_PASSWORD must contain between 16 and 128 characters for account creation.");
  }
  const passwordHash = initial.action === "WOULD_CREATE" ? await hashPassword(password) : null;
  const now = new Date();

  const result = await client.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('lnx-production-admin-bootstrap')) IS NULL AS locked`;
    const target = await transaction.user.findUnique({
      where: { email },
      select: { id: true, role: true, status: true, emailVerified: true, emailVerifiedAt: true },
    });
    if (target && (!target.emailVerified || !target.emailVerifiedAt || target.status !== "ACTIVE")) {
      throw new ProductionBootstrapError("The existing target account is not verified and active; it will not be modified.");
    }
    if (target?.role === "ADMIN") return { action: "NONE" as const, userId: target.id };
    if (target) {
      const promoted = await transaction.user.update({ where: { id: target.id }, data: { role: "ADMIN" }, select: { id: true } });
      return { action: "PROMOTED" as const, userId: promoted.id };
    }
    if (!passwordHash) throw new ProductionBootstrapError("The production administrator password is unavailable.");
    const user = await transaction.user.create({
      data: {
        email,
        displayName: "LNX Beats — Production Admin",
        emailVerified: true,
        emailVerifiedAt: now,
        status: "ACTIVE",
        role: "ADMIN",
      },
      select: { id: true },
    });
    await transaction.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
    return { action: "CREATED" as const, userId: user.id };
  });
  return { ...result, targetEmailMasked: maskEmail(email) };
}

import "server-only";

import { configuredAdminEmail, isPersistentLocalPreview } from "@/lib/auth/environment";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const BOOTSTRAP_CONFIRMATION = "promote-verified-admin";

export class AdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

function assertLocalBootstrapEnvironment(confirmation: string | undefined) {
  if (confirmation !== BOOTSTRAP_CONFIRMATION) {
    throw new AdminBootstrapError("The explicit admin bootstrap confirmation is missing.");
  }
  if (!process.env.DATABASE_URL) throw new AdminBootstrapError("DATABASE_URL is required.");

  const databaseUrl = new URL(process.env.DATABASE_URL);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname);
  if (!loopback || !databaseUrl.port || databaseUrl.port === "5432") {
    throw new AdminBootstrapError("Admin bootstrap is restricted to an isolated local PostgreSQL instance.");
  }

  const target = process.env.LNX_DATABASE_TARGET ?? "";
  const disposableQa = process.env.NODE_ENV === "test" && target.endsWith("-test");
  if (!disposableQa && !isPersistentLocalPreview()) {
    throw new AdminBootstrapError("The database target is not approved for local admin bootstrap.");
  }
}

export async function promoteConfiguredAdmin(confirmation = process.env.ADMIN_BOOTSTRAP_CONFIRM) {
  assertDatabaseConfigured();
  assertLocalBootstrapEnvironment(confirmation);
  const email = configuredAdminEmail();

  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { email } });
    if (!user) {
      throw new AdminBootstrapError("Create and verify the configured account through the public registration flow first.");
    }
    if (!user.emailVerified || !user.emailVerifiedAt || user.status !== "ACTIVE") {
      throw new AdminBootstrapError("The configured account must be verified and active before promotion.");
    }
    if (user.role === "ADMIN") return { changed: false as const, userId: user.id };

    const updated = await transaction.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
      select: { id: true },
    });
    return { changed: true as const, userId: updated.id };
  });
}

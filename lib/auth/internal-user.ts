import "server-only";

import { hashPassword } from "@/lib/auth/password";
import { isUserRole, type UserRole } from "@/lib/auth/roles";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type InternalUserInput = {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
};

export async function createInternalAuthUser(input: InternalUserInput) {
  assertDatabaseConfigured();

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
    throw new Error("A valid email address is required.");
  }
  if (input.password.length < 12 || input.password.length > 128) {
    throw new Error("The password must contain between 12 and 128 characters.");
  }
  if (!displayName || displayName.length > 120) {
    throw new Error("A display name between 1 and 120 characters is required.");
  }
  if (!isUserRole(input.role)) {
    throw new Error("A valid internal role is required.");
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        email,
        displayName,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
        role: input.role,
      },
    });

    await transaction.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });

    return user;
  });
}

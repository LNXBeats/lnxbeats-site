import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { hashOpaqueToken } from "@/lib/auth/tokens";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const USED_IDENTIFIER_PREFIX = "lnx-email-used:";

export async function consumeEmailVerification(token: string) {
  assertDatabaseConfigured();
  if (token.length < 20 || token.length > 2_048 || /\s/.test(token)) return false;

  const identifier = `${USED_IDENTIFIER_PREFIX}${hashOpaqueToken(token)}`;
  if (await prisma.verification.findUnique({ where: { identifier } })) return false;

  try {
    await auth.api.verifyEmail({ query: { token } });
  } catch {
    return false;
  }

  try {
    await prisma.verification.create({
      data: {
        identifier,
        value: "lnx-email-consumed",
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
  return true;
}

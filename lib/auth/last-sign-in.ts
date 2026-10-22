import "server-only";

import { successfulSignInReceipt } from "@/lib/auth/last-sign-in-policy";

type SignInDatabase = { user: { updateMany(input: {
  where: { id: string; status: "ACTIVE"; emailVerified: true; OR: Array<{ lastSignedInAt: null } | { lastSignedInAt: { lt: Date } }> };
  data: { lastSignedInAt: Date };
}): Promise<{ count: number }> } };

/** Called only after Better Auth has created a credential-authenticated session.
 * Monotone, durable across session deletion, and never a visitor/IP tracker.
 * A bookkeeping failure must not turn valid credentials into a failed login. */
export async function recordSuccessfulSignIn(
  db: SignInDatabase,
  session: { userId: string; createdAt: Date | string },
  endpoint: string | null | undefined,
  now = new Date(),
  warn: (code: string) => void = code => console.warn(code),
) {
  const receipt = successfulSignInReceipt(session, endpoint, now);
  if (!receipt) return false;
  try {
    const result = await db.user.updateMany({
      where: { id: receipt.userId, status: "ACTIVE", emailVerified: true, OR: [{ lastSignedInAt: null }, { lastSignedInAt: { lt: receipt.signedInAt } }] },
      data: { lastSignedInAt: receipt.signedInAt },
    });
    return result.count > 0;
  } catch {
    // No user ID, address, cookie, token, IP or raw database error in logs.
    warn("LAST_SIGN_IN_RECORDING_UNAVAILABLE");
    return false;
  }
}

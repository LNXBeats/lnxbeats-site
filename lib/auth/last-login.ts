import "server-only";

type CreatedSession = {
  userId: string;
  createdAt: Date;
};

export type LastLoginUserStore = {
  updateMany(input: {
    where: {
      id: string;
      OR: ({ lastLoginAt: null } | { lastLoginAt: { lt: Date } })[];
    };
    data: { lastLoginAt: Date };
  }): PromiseLike<unknown>;
};

export async function recordSuccessfulLogin(
  session: CreatedSession,
  context: { path?: string } | null | undefined,
  users: LastLoginUserStore,
) {
  // Better Auth also creates replacement sessions after password changes.
  // Only the enabled credential sign-in endpoint represents a new login.
  if (context?.path !== "/sign-in/email") return;

  try {
    // One conditional write keeps delayed concurrent hooks from moving the
    // timestamp backwards. This value survives session expiry and sign-out.
    await users.updateMany({
      where: {
        id: session.userId,
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: session.createdAt } }],
      },
      data: { lastLoginAt: session.createdAt },
    });
  } catch {
    // Admin metadata must not turn a valid sign-in into a failed response.
    // Keep credentials, user identifiers and database details out of logs.
    console.error("auth.last_login.record_failed");
  }
}

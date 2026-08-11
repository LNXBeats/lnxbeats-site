import "server-only";

import { randomBytes } from "node:crypto";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { sendPasswordResetEmail } from "@/lib/auth/email-delivery";
import { issueEmailVerification } from "@/lib/auth/email-verification";
import { isPersistentLocalPreview } from "@/lib/auth/environment";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
const isProduction = process.env.NODE_ENV === "production";
const useSecureCookies = isProduction && !isPersistentLocalPreview();
const authSecret = process.env.AUTH_SECRET
  ?? (process.env.NEXT_PHASE === "phase-production-build" ? randomBytes(32).toString("base64url") : undefined);

export const auth = betterAuth({
  appName: "LNX Studio",
  baseURL: authBaseUrl,
  // A transient build-only secret lets static public routes compile without a
  // deployed secret. A real runtime still fails closed when AUTH_SECRET is absent.
  secret: authSecret,
  trustedOrigins: [authBaseUrl],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 1_800,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendPasswordResetEmail({ email: user.email, url });
    },
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    async sendVerificationEmail({ user, token }) {
      await issueEmailVerification({ email: user.email, token });
    },
    async afterEmailVerification(user) {
      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { status: true },
      });
      if (!currentUser) return;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          status: currentUser.status === "PENDING" ? "ACTIVE" : currentUser.status,
        },
      });
    },
  },
  user: {
    fields: {
      name: "displayName",
    },
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
    additionalFields: {
      role: {
        type: ["ADMIN", "MEMBER", "CUSTOMER"],
        input: false,
        defaultValue: "MEMBER",
      },
      status: {
        type: ["PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
        input: false,
        defaultValue: "PENDING",
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    freshAge: 60 * 30,
    cookieCache: { enabled: false },
    preserveSessionInDatabase: false,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 600, max: 5 },
      "/send-verification-email": { window: 3_600, max: 3 },
      "/request-password-reset": { window: 3_600, max: 3 },
      "/reset-password": { window: 900, max: 5 },
      "/change-password": { window: 900, max: 5 },
      "/update-user": { window: 600, max: 10 },
    },
  },
  verification: {
    storeIdentifier: "hashed",
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          return { data: { ...user, role: "MEMBER", status: "PENDING", emailVerified: false } };
        },
      },
    },
    session: {
      create: {
        async before(session) {
          assertDatabaseConfigured();
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          return user?.status === "ACTIVE";
        },
      },
    },
  },
  advanced: {
    disableCSRFCheck: false,
    disableOriginCheck: false,
    cookiePrefix: "lnx-studio",
    useSecureCookies,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: "lax",
      path: "/",
    },
    database: {
      generateId: "uuid",
    },
  },
  logger: {
    level: "error",
  },
});

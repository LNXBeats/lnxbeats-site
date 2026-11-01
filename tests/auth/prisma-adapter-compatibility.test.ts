import assert from "node:assert/strict";
import test from "node:test";

// Initialise the actual configuration against the generated Prisma schema, but
// never connect to a database, send email or load a real environment file.
process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/auth_adapter_unit_only";
process.env.AUTH_SECRET = "synthetic-auth-adapter-compatibility-unit-test-only-secret";
process.env.AUTH_URL = "http://127.0.0.1:3199";

test("Better Auth initialises the existing Prisma schema without an issuer migration", async () => {
  const { prisma } = await import("@/lib/prisma");
  let queries = 0;
  const requestClient = prisma as unknown as { _request: (...args: unknown[]) => unknown };
  const originalRequest = requestClient._request;
  requestClient._request = () => { queries++; throw new Error("Database access is forbidden in this compatibility test"); };
  try {
    const { auth } = await import("@/lib/auth");
    const context = await auth.$context;
    // Initialisation starts this check in the background and only logs errors.
    // Await it explicitly so an incompatible generated schema fails the test.
    assert.equal(typeof context.checkSchema, "function");
    await context.checkSchema!();
    assert.equal(context.options.user?.fields?.name, "displayName");
    assert.equal(context.options.emailAndPassword?.disableSignUp, true);
    assert.equal(context.options.emailAndPassword?.revokeSessionsOnPasswordReset, true);
    assert.equal(context.options.verification?.storeIdentifier, "hashed");
    assert.equal(queries, 0);
  } finally {
    requestClient._request = originalRequest;
    await prisma.$disconnect();
  }
});

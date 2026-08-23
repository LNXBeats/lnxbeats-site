import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@/generated/prisma/client";
import { ADMIN_PRINCIPAL_EMAIL } from "@/lib/auth/environment";
import { verifyPassword } from "@/lib/auth/password";
import { applyProductionAdminBootstrap, planProductionAdminBootstrap } from "@/lib/production/admin-bootstrap";
import {
  ADMIN_PRODUCTION_CONFIRMATION,
  ProductionBootstrapError,
  safeProductionBootstrapErrorMessage,
} from "@/lib/production/bootstrap-environment";

const PASSWORD = "temporary-production-password-2026";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    LNX_DATABASE_TARGET: "lnx-studio-production",
    AUTH_URL: "https://www.lnxbeats.fr",
    APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    DATABASE_URL: "postgresql://app:secret@production.internal:5432/lnx_production",
    ADMIN_EMAIL: ADMIN_PRINCIPAL_EMAIL,
    ADMIN_BOOTSTRAP_CONFIRM: ADMIN_PRODUCTION_CONFIRMATION,
    ADMIN_BOOTSTRAP_PASSWORD: PASSWORD,
    ...overrides,
  };
}

type FakeUser = { id: string; email: string; role: "ADMIN" | "MEMBER"; status: "ACTIVE" | "PENDING"; emailVerified: boolean; emailVerifiedAt: Date | null };

function fakeClient(seed: FakeUser[] = []) {
  const users = [...seed];
  const accounts: Array<{ userId: string; password: string }> = [];
  let sequence = users.length;
  const user = {
    count: async (args?: { where?: { role?: string } }) => args?.where?.role ? users.filter((item) => item.role === args.where!.role).length : users.length,
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => users.find((item) => item.email === where.email || item.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
      const target = users.find((item) => item.id === where.id)!; Object.assign(target, data); return target;
    },
    create: async ({ data }: { data: Omit<FakeUser, "id"> & { displayName: string } }) => {
      const created: FakeUser = { ...data, id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };
      users.push(created); return created;
    },
  };
  const transaction = {
    user,
    account: { create: async ({ data }: { data: { userId: string; password: string } }) => { accounts.push({ userId: data.userId, password: data.password }); return data; } },
    $queryRaw: async () => [{ locked: true }],
  };
  const client = {
    user,
    $transaction: async (operation: (value: typeof transaction) => unknown) => operation(transaction),
  } as unknown as PrismaClient;
  return { client, users, accounts };
}

test("production admin dry-run inspects without mutating", async () => {
  const state = fakeClient();
  const plan = await planProductionAdminBootstrap(state.client, environment());
  assert.equal(plan.action, "WOULD_CREATE");
  assert.equal(state.users.length, 0);
  assert.match(plan.targetEmailMasked, /^l\*\*\*@/);
});

test("admin apply requires the exact confirmation and production environment", async () => {
  const state = fakeClient();
  await assert.rejects(() => applyProductionAdminBootstrap(state.client, environment({ ADMIN_BOOTSTRAP_CONFIRM: undefined })), ProductionBootstrapError);
  await assert.rejects(() => planProductionAdminBootstrap(state.client, environment({ NODE_ENV: "development" })), ProductionBootstrapError);
  await assert.rejects(() => planProductionAdminBootstrap(state.client, environment({ AUTH_URL: "https://staging.lnxbeats.fr" })), ProductionBootstrapError);
  await assert.rejects(() => planProductionAdminBootstrap(state.client, environment({ DATABASE_URL: "postgresql://x:y@localhost:5544/local" })), ProductionBootstrapError);
  assert.equal(state.users.length, 0);
});

test("admin target is mandatory and fixed", async () => {
  const state = fakeClient();
  await assert.rejects(() => planProductionAdminBootstrap(state.client, environment({ ADMIN_EMAIL: undefined })), ProductionBootstrapError);
  await assert.rejects(() => planProductionAdminBootstrap(state.client, environment({ ADMIN_EMAIL: "attacker@example.com" })), ProductionBootstrapError);
});

test("first production admin is created with a compatible credential account", async () => {
  const state = fakeClient();
  const result = await applyProductionAdminBootstrap(state.client, environment());
  assert.equal(result.action, "CREATED");
  assert.equal(state.users.length, 1);
  assert.equal(state.users[0]?.role, "ADMIN");
  assert.equal(state.users[0]?.status, "ACTIVE");
  assert.equal(state.users[0]?.emailVerified, true);
  assert.equal(await verifyPassword(state.accounts[0]!.password, PASSWORD), true);
});

test("verified active MEMBER is promoted without changing its credential", async () => {
  const existing: FakeUser = { id: "00000000-0000-4000-8000-000000000101", email: ADMIN_PRINCIPAL_EMAIL, role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() };
  const state = fakeClient([existing]);
  const result = await applyProductionAdminBootstrap(state.client, environment({ ADMIN_BOOTSTRAP_PASSWORD: undefined }));
  assert.equal(result.action, "PROMOTED");
  assert.equal(existing.role, "ADMIN");
  assert.equal(state.accounts.length, 0);
});

test("existing ADMIN is an idempotent no-op and other admins remain untouched", async () => {
  const target: FakeUser = { id: "00000000-0000-4000-8000-000000000102", email: ADMIN_PRINCIPAL_EMAIL, role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() };
  const other: FakeUser = { id: "00000000-0000-4000-8000-000000000103", email: "other@example.com", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() };
  const state = fakeClient([target, other]);
  assert.equal((await applyProductionAdminBootstrap(state.client, environment({ ADMIN_BOOTSTRAP_PASSWORD: undefined }))).action, "NONE");
  assert.equal(state.users.filter(({ role }) => role === "ADMIN").length, 2);
});

test("an unverified or inactive collision fails closed", async () => {
  const target: FakeUser = { id: "00000000-0000-4000-8000-000000000104", email: ADMIN_PRINCIPAL_EMAIL, role: "MEMBER", status: "PENDING", emailVerified: false, emailVerifiedAt: null };
  const state = fakeClient([target]);
  await assert.rejects(() => applyProductionAdminBootstrap(state.client, environment()), ProductionBootstrapError);
  assert.equal(target.role, "MEMBER");
});

test("bootstrap failures never echo the temporary password", async () => {
  const state = fakeClient();
  await assert.rejects(
    () => applyProductionAdminBootstrap(state.client, environment({ ADMIN_BOOTSTRAP_CONFIRM: "wrong" })),
    (error: unknown) => error instanceof Error && !error.message.includes(PASSWORD),
  );
});

test("unexpected provider or database errors are reduced to a neutral CLI message", () => {
  const leaked = "postgresql://owner:secret@private.internal/production";
  const output = safeProductionBootstrapErrorMessage(new Error(leaked), "Bootstrap failed safely.");
  assert.equal(output, "Bootstrap failed safely.");
  assert.doesNotMatch(output, /secret|private\.internal|postgresql:/);
});

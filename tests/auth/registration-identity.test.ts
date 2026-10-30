import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAllowedRegistrationCompletionPayload, validateRegistrationIdentity } from "@/lib/auth/input";
import { hashOpaqueToken } from "@/lib/auth/tokens";
import { accountMessages } from "@/lib/i18n/messages-account";

// This file intercepts every transaction with a synthetic in-memory repository.
// No database, authentication session, email or external request is used.
process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/registration_identity_unit_only";
process.env.AUTH_SECRET = "synthetic-registration-identity-unit-test-only-secret";
process.env.AUTH_URL = "http://localhost:3199";
const { prisma } = await import("@/lib/prisma");
const { completeRegistration, registrationProofCookie, RegistrationServiceError } = await import("@/lib/auth/registration");
const { POST } = await import("@/app/api/auth/registration/complete/route");

const names = { firstName: "  Marie-Claire  ", lastName: "  D’Arcy  Martin  " };
const passwords = { password: "A synthetic passphrase only 2026", passwordConfirmation: "A synthetic passphrase only 2026" };

test("registration asks for both declared names and normalizes without inventing identity", () => {
  assert.deepEqual(validateRegistrationIdentity(names), { ok: true, value: { firstName: "Marie-Claire", lastName: "D’Arcy Martin", displayName: "Marie-Claire D’Arcy Martin" } });
  for (const pair of [{ firstName: "李", lastName: "王" }, { firstName: "太郎", lastName: "山田" }, { firstName: "João", lastName: "da Silva" }, { firstName: "E\u0301loïse", lastName: "Le  Guen" }]) {
    const parsed = validateRegistrationIdentity(pair);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.firstName, pair.firstName.normalize("NFC"));
  }
});

test("missing, whitespace-only, invisible-only, wrong-type and oversized names are rejected", () => {
  for (const value of [undefined, null, "", "  ", "\u200b", 12, {}, [], "123", "A".repeat(101), "A\nB", "<img>"]) {
    const first = validateRegistrationIdentity({ firstName: value, lastName: "Martin" });
    const last = validateRegistrationIdentity({ firstName: "Marie", lastName: value });
    assert.equal(first.ok, false, String(value));
    assert.equal(last.ok, false, String(value));
    if (!first.ok) assert.equal(first.field, "firstName");
    if (!last.ok) assert.equal(last.field, "lastName");
  }
});

test("separate names remain complete when the existing display field needs a bounded label", () => {
  const parsed = validateRegistrationIdentity({ firstName: "A".repeat(100), lastName: "B".repeat(100) });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.firstName.length, 100);
    assert.equal(parsed.value.lastName.length, 100);
    assert.equal(parsed.value.displayName.length, 120);
    assert.notEqual(parsed.value.displayName, "Membre LNX");
  }
});

test("completion requires names on the server and keeps the closed role/consent payload", () => {
  assert.equal(isAllowedRegistrationCompletionPayload(passwords), false);
  assert.equal(isAllowedRegistrationCompletionPayload({ ...passwords, ...names }), true);
  for (const extra of [{ role: "ADMIN" }, { emailVerified: true }, { displayName: "Alias" }, { name: "Alias" }, { releaseAlerts: { music: "yes", shop: false, editorial: false, locale: "fr" } }])
    assert.equal(isAllowedRegistrationCompletionPayload({ ...passwords, ...names, ...extra }), false);
});

function fixture(existing?: { id: string; displayName: string; firstName: string | null; lastName: string | null }) {
  const proof = "A".repeat(43), id = "20686f82-c930-4318-892c-b46c6b55b48e";
  const attempt = { id, email: "registration-identity@example.invalid", verifiedAt: new Date(), consumedAt: null as Date | null,
    continuationHash: hashOpaqueToken(proof), continuationExpiresAt: new Date(Date.now() + 600_000) };
  const writes: Array<{ kind: string; data: Record<string, unknown> }> = [];
  let user: Record<string, unknown> | null = existing ?? null;
  const transaction = {
    $queryRaw: async () => [],
    rateLimit: { findUnique: async () => null, create: async () => ({}) },
    registrationAttempt: { findUnique: async () => attempt, update: async ({ data }: { data: { consumedAt: Date } }) => { Object.assign(attempt, data); return attempt; } },
    user: {
      findUnique: async () => user,
      create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "user", data }); user = { id: "synthetic-member", ...data }; return user; },
    },
    account: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "account", data }); return data; } },
  };
  const repository = prisma as unknown as Record<string, unknown>, original = repository.$transaction;
  let calls = 0;
  repository.$transaction = async (callback: (db: unknown) => Promise<unknown>) => { calls++; return callback(transaction); };
  const intercepted = { mock: { callCount: () => calls, restore: () => { repository.$transaction = original; } } };
  return { writes, intercepted, input: { ...names, password: passwords.password, cookieHeader: registrationProofCookie(id, proof), clientAddress: "127.0.0.1" } };
}

test("new account stores the provided names once, with unchanged MEMBER status and password flow", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await completeRegistration(f.input), { completed: true });
    assert.deepEqual(await completeRegistration(f.input), { completed: true });
    assert.deepEqual(f.writes.map(write => write.kind), ["user", "account"]);
    const user = f.writes[0].data;
    assert.equal(user.firstName, "Marie-Claire"); assert.equal(user.lastName, "D’Arcy Martin");
    assert.equal(user.displayName, "Marie-Claire D’Arcy Martin");
    assert.equal(user.role, "MEMBER"); assert.equal(user.status, "ACTIVE"); assert.equal(user.emailVerified, true);
    assert.match(String(f.writes[1].data.password), /^\$argon2id\$/);
  } finally { f.intercepted.mock.restore(); }
});

test("an existing account is never renamed or backfilled by registration completion", async () => {
  const existing = { id: "existing-member", displayName: "Membre LNX", firstName: null, lastName: null };
  const f = fixture(existing);
  try {
    assert.deepEqual(await completeRegistration(f.input), { completed: true });
    assert.equal(f.writes.length, 0);
    assert.deepEqual(existing, { id: "existing-member", displayName: "Membre LNX", firstName: null, lastName: null });
  } finally { f.intercepted.mock.restore(); }
});

test("invalid service names fail before any transaction or credential creation", async () => {
  const f = fixture();
  try {
    await assert.rejects(completeRegistration({ ...f.input, firstName: " " }), error => error instanceof RegistrationServiceError && error.status === 400 && error.code === "INVALID_REGISTRATION_NAME");
    assert.equal(f.intercepted.mock.callCount(), 0); assert.equal(f.writes.length, 0);
  } finally { f.intercepted.mock.restore(); }
});

test("HTTP completion rejects missing names and injected roles without a database or email", async () => {
  const f = fixture();
  try {
    for (const body of [passwords, { ...passwords, firstName: "Marie" }, { ...passwords, ...names, role: "ADMIN" }]) {
      const response = await POST(new Request("http://localhost:3199/api/auth/registration/complete", { method: "POST", headers: { origin: "http://localhost:3199", "content-type": "application/json" }, body: JSON.stringify(body) }));
      assert.equal(response.status, 400); assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(f.intercepted.mock.callCount(), 0);
  } finally { f.intercepted.mock.restore(); }
});

test("name inputs have accessible labels, autocomplete and errors; translations cover six languages", async () => {
  const form = await readFile(new URL("../../components/auth/registration-form.tsx", import.meta.url), "utf8");
  for (const [name, autocomplete] of [["firstName", "given-name"], ["lastName", "family-name"]]) {
    assert.match(form, new RegExp(`name="${name}"[^>]*autoComplete="${autocomplete}"[^>]*required[^>]*maxLength=\\{100\\}[^>]*aria-invalid`));
    assert.match(form, new RegExp(`${name}: identity\\.value\\.${name}`));
  }
  assert.match(form, /role="alert"/); assert.match(form, /\.focus\(\)/); assert.doesNotMatch(form, /\.reset\(\)|Membre LNX/);
  for (const text of ["Prénom", "Nom de famille", "Saisissez votre prénom (100 caractères maximum).", "Saisissez votre nom de famille (100 caractères maximum)."])
    assert.equal(accountMessages[text]?.filter(value => value.trim()).length, 5, text);
});

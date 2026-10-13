/** Explicitly authorized local QA credential containment. Never a production provisioner. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
assert.deepEqual(process.argv.slice(2), ["--authorized-four-local-qa-accounts"]);
const cfg = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8"));
const target = assertSafeLocalPostgresUrl(cfg.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55473");
assert.equal(target.pathname, "/lnx_dcn_runtime_test"); assert.equal(target.username, "dcn_runtime_a");
assert.equal(cfg.DCN_MODE, "TEST"); assert.equal(cfg.MEDIA_STORAGE_DRIVER, "local");
assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED, "false"); assert.equal(cfg.EMAIL_PROVIDER, "capture");
const credentialsPath = ".private/dcn-review-credentials.json";
const st = await lstat(credentialsPath); assert.ok(st.isFile() && !st.isSymbolicLink() && (st.mode & 0o077) === 0);
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const emails = ["dcn-review-admin@example.invalid", "dcn-review-member@example.invalid", "dcn11-review-member@example.invalid", "dcn12-review-member@example.invalid"];
assert.deepEqual([credentials.adminEmail, credentials.memberEmail, credentials.dcn11MemberEmail, credentials.dcn12MemberEmail], emails);
target.username = "dcn_owner";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
let replacement = randomBytes(32).toString("base64url");
try {
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  assert.equal(users.length, 4); const userIds = users.map(u => u.id);
  const snapshot = async () => db.digitalOrder.findMany({ where: { userId: { in: userIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, totalCents: true, contractSnapshot: true, lines: { orderBy: { id: "asc" }, select: { id: true, trackSnapshot: true, entitlements: { orderBy: { id: "asc" }, select: { id: true, masterId: true, status: true } } } } } });
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const before = fingerprint(await snapshot());
  const passwordHash = await hashPassword(replacement);
  // Stage a recoverable private replacement before the atomic database operation.
  const staged = `${credentialsPath}.rotation.pending`;
  await writeFile(staged, JSON.stringify({ ...credentials, password: replacement }, null, 2), { mode: 0o600, flag: "wx" });
  let revoked = 0;
  await db.$transaction(async tx => {
    const accounts = await tx.account.findMany({ where: { userId: { in: userIds }, providerId: "credential" } });
    assert.equal(accounts.length, 4);
    for (const account of accounts) {
      assert.equal(account.accountId, account.userId);
      await tx.account.update({ where: { id: account.id }, data: { password: passwordHash } });
    }
    revoked = (await tx.session.deleteMany({ where: { userId: { in: userIds } } })).count;
  });
  await rename(staged, credentialsPath);
  const accounts = await db.account.findMany({ where: { userId: { in: userIds }, providerId: "credential" }, select: { password: true } });
  for (const account of accounts) {
    assert.ok(account.password); assert.equal(await verifyPassword(account.password, credentials.password), false);
    assert.equal(await verifyPassword(account.password, replacement), true);
  }
  assert.equal(await db.session.count({ where: { userId: { in: userIds } } }), 0);
  assert.equal(fingerprint(await snapshot()), before);
  assert.equal((await lstat(credentialsPath)).mode & 0o077, 0);
  const proof = { exportFiltered: true, environment: "LOCAL_QA_127.0.0.1_55473", authorizedQaAccounts: 4, passwordsRotated: 4, oldPasswordRejected: true, newPasswordVerifiedLocally: true, sessionsRevoked: revoked, sessionsRemaining: 0, credentialsFileMode: "0600", acquiredOrdersSnapshotsAndRightsUnchanged: true, productionMutation: false, providerCalls: 0 };
  await mkdir("output/dcn-1-2/proofs", { recursive: true });
  await writeFile("output/dcn-1-2/proofs/qa-credential-containment.json", `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof));
} catch {
  console.error("Local QA rotation failed; sensitive details deliberately not printed."); process.exitCode = 1;
} finally { replacement = ""; credentials.password = ""; await db.$disconnect(); }

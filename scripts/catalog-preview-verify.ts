import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const backupDirectory = process.argv[2];
if (!backupDirectory?.startsWith("/private/tmp/lnx-studio-v0603-preview-backup-")) throw new Error("A valid preview backup directory is required.");
const [{ assertApprovedCatalogDatabase }, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"), import("@/lib/prisma"),
]);
const protectedTables = ["users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_rate_limits", "auth_registration_attempts", "customers", "orders", "order_events", "order_assets", "commercial_licenses"] as const;
function serialized(value: unknown) { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item instanceof Date ? item.toISOString() : item); }

async function run() {
  const { target } = await assertApprovedCatalogDatabase();
  assert.equal(target, "lnx-studio-local-preview");
  const expected = JSON.parse(await readFile(join(backupDirectory, "protected-integrity.json"), "utf8")) as Record<string, { count: number; sha256: string }>;
  for (const table of protectedTables) {
    const content = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "${table}" ORDER BY 1`);
    assert.deepEqual({ count: content.length, sha256: createHash("sha256").update(serialized(content)).digest("hex") }, expected[table], `${table} changed during catalogue migration.`);
  }
  const ownerEmail = process.env.ADMIN_EMAIL;
  assert.ok(ownerEmail, "ADMIN_EMAIL must identify the owner for this local integrity check.");
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { emailVerified: true, status: true, role: true, displayName: true, sessions: { select: { id: true, expiresAt: true } } },
  });
  assert.ok(owner);
  assert.equal(owner.emailVerified, true); assert.equal(owner.status, "ACTIVE"); assert.equal(owner.role, "ADMIN"); assert.ok(owner.displayName.trim().length > 0);
  console.info(`Protected preview integrity passed: ${protectedTables.length}/${protectedTables.length} tables unchanged.`);
  console.info(`Owner account preserved: verified, ACTIVE, ADMIN, displayName present, ${owner.sessions.length} session(s).`);
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Preview integrity check failed.");
  process.exitCode = 1;
});

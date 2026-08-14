import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [{ assertApprovedCatalogDatabase }, { prisma }] = await Promise.all([
  import("@/scripts/catalog-guard"), import("@/lib/prisma"),
]);

const catalogTables = ["projects", "tracks", "platform_links", "credits", "confidence_annotations", "assets", "project_assets", "favorites"] as const;
const protectedTables = ["users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_rate_limits", "auth_registration_attempts", "customers", "orders", "order_events", "order_assets", "commercial_licenses", "payments", "provider_events"] as const;
const expectedPostMigrationEmptyTables = ["order_notifications"] as const;

function serialized(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item instanceof Date ? item.toISOString() : item);
}
async function rows(table: string) {
  if (![...catalogTables, ...protectedTables].includes(table as never)) throw new Error("Backup table refused.");
  return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "${table}" ORDER BY 1`);
}

async function run() {
  const { target } = await assertApprovedCatalogDatabase();
  if (target !== "lnx-studio-local-preview") throw new Error("Logical preview backup refused outside lnx-studio-local-preview.");
  const directory = await mkdtemp("/private/tmp/lnx-studio-v0604-preview-backup-");
  const catalog: Record<string, unknown> = {};
  const integrity: Record<string, { count: number; sha256: string }> = {};
  for (const table of catalogTables) {
    const content = await rows(table);
    catalog[table] = table === "assets"
      ? content.map((asset) => {
          const stableAsset = { ...asset };
          delete stableAsset.duration_ms;
          return stableAsset;
        })
      : content;
  }
  for (const table of protectedTables) {
    const content = await rows(table);
    integrity[table] = { count: content.length, sha256: createHash("sha256").update(serialized(content)).digest("hex") };
  }
  const catalogJson = serialized(catalog);
  await writeFile(join(directory, "catalog-logical-backup.json"), `${catalogJson}\n`, { mode: 0o600 });
  await writeFile(join(directory, "protected-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify({ target, createdAt: new Date().toISOString(), catalogSha256: createHash("sha256").update(catalogJson).digest("hex"), catalogTables, protectedTables, expectedPostMigrationEmptyTables }, null, 2)}\n`, { mode: 0o600 });
  console.info(`Preview logical catalogue backup created: ${directory}`);
  console.info(`Protected integrity snapshot created for ${protectedTables.length} tables (no secret values written).`);
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Preview backup failed.");
  process.exitCode = 1;
});

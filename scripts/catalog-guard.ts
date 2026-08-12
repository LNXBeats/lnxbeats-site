import { readFile } from "node:fs/promises";

const allowedTargets = new Set(["lnx-studio-v0603-test", "lnx-studio-v0604-test", "lnx-studio-local-preview"]);

export async function assertApprovedCatalogDatabase() {
  const target = process.env.LNX_DATABASE_TARGET;
  const databaseUrl = process.env.DATABASE_URL;
  if (!target || !allowedTargets.has(target)) throw new Error("Catalogue migration refused: database target is not approved.");
  if (!databaseUrl) throw new Error("Catalogue migration refused: DATABASE_URL is absent.");
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) || !url.port || url.port === "5432") {
    throw new Error("Catalogue migration refused: only the isolated local Prisma runtime is accepted.");
  }
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  if (proofPath) {
    const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; exports?: { database?: { connectionString?: string } } };
    if (proof.name !== target || proof.exports?.database?.connectionString !== databaseUrl) {
      throw new Error("Catalogue migration refused: Prisma runtime proof does not match the selected target.");
    }
  }
  return { target };
}

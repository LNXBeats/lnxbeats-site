import path from "node:path";

import {
  applyProductionMediaImport,
  createProductionR2MediaProvider,
  planProductionMediaImport,
} from "@/lib/production/media-import";
import { prisma } from "@/lib/prisma";
import { safeProductionBootstrapErrorMessage } from "@/lib/production/bootstrap-environment";

const argumentsProvided = process.argv.slice(2);
const apply = argumentsProvided.includes("--apply");
const manifestArgument = argumentsProvided.find((argument) => argument.startsWith("--manifest="));
const unknownArgument = argumentsProvided.find((argument) => argument !== "--apply" && !argument.startsWith("--manifest="));
const manifestPath = path.resolve(manifestArgument?.slice("--manifest=".length) || "data/production-media-manifest.json");
const sourceRoot = process.env.MEDIA_PRODUCTION_SOURCE_ROOT?.trim();

async function run() {
  if (unknownArgument) throw new Error("Unsupported production media import argument.");
  if (!sourceRoot) throw new Error("MEDIA_PRODUCTION_SOURCE_ROOT is required.");
  const plan = await planProductionMediaImport(prisma, manifestPath, sourceRoot);
  console.info("MEDIA_PRODUCTION_IMPORT");
  console.info(`manifestFormat=${plan.manifest.format}`);
  console.info(`objects=${plan.prepared.length}`);
  console.info(`bytes=${plan.totalBytes}`);
  console.info(`public=${plan.publicObjects}`);
  console.info(`private=${plan.privateObjects}`);
  console.info(`databaseWouldCreate=${plan.database.creates.length}`);
  console.info(`databaseWouldSkip=${plan.database.skips.length}`);
  console.info("conflicts=0");
  if (!apply) {
    console.info("providerCalls=0");
    console.info("status=DRY_RUN_SAFE");
    return;
  }
  const result = await applyProductionMediaImport(
    prisma,
    createProductionR2MediaProvider(),
    manifestPath,
    sourceRoot,
  );
  console.info(`uploaded=${result.uploaded}`);
  console.info(`storageSkipped=${result.storageSkipped}`);
  console.info(`databaseCreated=${result.databaseCreated}`);
  console.info(`databaseSkipped=${result.databaseSkipped}`);
  console.info("status=APPLIED");
}

run()
  .catch((error: unknown) => {
    console.error(safeProductionBootstrapErrorMessage(error, "Production media import failed safely; inspect server diagnostics."));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
